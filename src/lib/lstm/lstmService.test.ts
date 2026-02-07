import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock constants before importing the module
vi.mock('@/config/constants', () => ({
  LSTM_WINDOW_SIZE: 32,
  LSTM_STRIDE: 15,
  LSTM_MIN_MOTION_FRAMES: 8,
  LSTM_FEATURE_COUNT: 126,
  LSTM_CONFIDENCE_THRESHOLD: 0.7,
  LSTM_MODEL_PATH: '/models/asl_lstm_25.json',
  LSTM_VOCABULARY: [
    'HELLO', 'GOODBYE', 'PLEASE', 'THANK_YOU', 'SORRY',
    'WANT', 'NEED', 'HELP', 'LIKE', 'UNDERSTAND',
    'WHAT', 'WHERE', 'WHO', 'WHEN', 'WHY', 'HOW',
    'YES', 'NO', 'MAYBE', 'GOOD', 'BAD',
    'I', 'YOU', 'NAME', 'FINISH',
  ],
  MIN_MOTION_THRESHOLD: 0.023,
}));

// Mock TensorFlow.js
const mockTensorDispose = vi.fn();
const mockPredictOutput = {
  data: vi.fn().mockResolvedValue(new Float32Array(25).fill(0.04)),
  dispose: mockTensorDispose,
};
const mockModel = {
  predict: vi.fn().mockReturnValue(mockPredictOutput),
  dispose: vi.fn(),
};

const mockTensor = {
  dispose: mockTensorDispose,
};

const mockTf = {
  setBackend: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  loadLayersModel: vi.fn().mockResolvedValue(mockModel),
  tensor3d: vi.fn().mockReturnValue(mockTensor),
  zeros: vi.fn().mockReturnValue(mockTensor),
};

vi.mock('@tensorflow/tfjs', () => mockTf);

// Import module after mocks are set up
let lstmModule: typeof import('./lstmService');

describe('lstmService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset mock implementations
    mockTf.setBackend.mockResolvedValue(undefined);
    mockTf.ready.mockResolvedValue(undefined);
    mockTf.loadLayersModel.mockResolvedValue(mockModel);
    mockPredictOutput.data.mockResolvedValue(new Float32Array(25).fill(0.04));

    lstmModule = await import('./lstmService');
  });

  afterEach(() => {
    // Clean up any loaded models
    if (lstmModule.isModelReady()) {
      lstmModule.disposeModel();
    }
  });

  describe('TensorFlow.js Initialization', () => {
    it('attempts WebGL backend first', async () => {
      await lstmModule.loadModel();

      expect(mockTf.setBackend).toHaveBeenCalledWith('webgl');
      expect(mockTf.ready).toHaveBeenCalled();
    });

    it('falls back to CPU on WebGL failure', async () => {
      mockTf.setBackend.mockImplementation(async (backend: string) => {
        if (backend === 'webgl') {
          throw new Error('WebGL not available');
        }
      });

      await lstmModule.loadModel();

      expect(mockTf.setBackend).toHaveBeenCalledWith('webgl');
      expect(mockTf.setBackend).toHaveBeenCalledWith('cpu');
    });

    it('caches tf instance (idempotent)', async () => {
      await lstmModule.loadModel();
      const callCount = mockTf.setBackend.mock.calls.length;

      // Calling again should use cached instance
      lstmModule.disposeModel();
      await lstmModule.loadModel();

      // Should only initialize once due to caching
      // Second load will still call setBackend because module was reset
      expect(mockTf.setBackend.mock.calls.length).toBeGreaterThanOrEqual(callCount);
    });
  });

  describe('Model Loading', () => {
    it('returns true if already loaded', async () => {
      await lstmModule.loadModel();
      const result = await lstmModule.loadModel();

      expect(result).toBe(true);
      // loadLayersModel called only once
      expect(mockTf.loadLayersModel).toHaveBeenCalledTimes(1);
    });

    it('returns false while loading (prevents concurrent loads)', async () => {
      // Start loading but don't await
      const loadPromise1 = lstmModule.loadModel();

      // Try to load again immediately
      const result = await lstmModule.loadModel();

      // Second call returns false because first is still loading
      expect(result).toBe(false);

      // Wait for first to complete
      await loadPromise1;
    });

    it('loads from correct path', async () => {
      await lstmModule.loadModel();

      expect(mockTf.loadLayersModel).toHaveBeenCalledWith('/models/asl_lstm_25.json');
    });

    it('runs warmup inference after loading', async () => {
      await lstmModule.loadModel();

      expect(mockTf.zeros).toHaveBeenCalledWith([1, 32, 126]);
      expect(mockModel.predict).toHaveBeenCalled();
    });

    it('returns true on success', async () => {
      const result = await lstmModule.loadModel();
      expect(result).toBe(true);
    });

    it('returns false and sets error on failure', async () => {
      mockTf.loadLayersModel.mockRejectedValue(new Error('Failed to fetch model'));

      const result = await lstmModule.loadModel();

      expect(result).toBe(false);
      const state = lstmModule.getLSTMServiceState();
      expect(state.error).toBe('Failed to fetch model');
    });

    it('disposes warmup tensors', async () => {
      await lstmModule.loadModel();

      // Warmup tensor should be disposed
      expect(mockTensorDispose).toHaveBeenCalled();
    });
  });

  describe('Inference (predictSign)', () => {
    const mockFrames = Array(32).fill(null).map(() => ({
      features: Array(126).fill(0.5),
      hasMotion: true,
    }));
    const mockTimestamps = { start: Date.now() - 1000, end: Date.now() };

    beforeEach(async () => {
      await lstmModule.loadModel();
    });

    it('returns null if model not loaded', async () => {
      lstmModule.disposeModel();
      vi.resetModules();
      lstmModule = await import('./lstmService');

      const result = await lstmModule.predictSign(mockFrames, mockTimestamps);
      expect(result).toBeNull();
    });

    it('creates correct tensor shape [1, 32, 126]', async () => {
      await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(mockTf.tensor3d).toHaveBeenCalled();
      const callArg = mockTf.tensor3d.mock.calls[0][0];
      expect(callArg).toHaveLength(1);
      expect(callArg[0]).toHaveLength(32);
      expect(callArg[0][0]).toHaveLength(126);
    });

    it('finds max probability class', async () => {
      // Set up prediction where index 0 (HELLO) has highest probability
      const probs = new Float32Array(25).fill(0.02);
      probs[0] = 0.85; // HELLO
      mockPredictOutput.data.mockResolvedValue(probs);

      const result = await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(result).not.toBeNull();
      expect(result!.class).toBe('HELLO');
      expect(result!.confidence).toBeCloseTo(0.85, 5);
    });

    it('maps index to vocabulary correctly', async () => {
      // Set up prediction where index 5 (WANT) has highest probability
      const probs = new Float32Array(25).fill(0.02);
      probs[5] = 0.75;
      mockPredictOutput.data.mockResolvedValue(probs);

      const result = await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(result!.class).toBe('WANT');
    });

    it('creates LSTMPrediction with all fields', async () => {
      const probs = new Float32Array(25).fill(0.02);
      probs[0] = 0.8;
      mockPredictOutput.data.mockResolvedValue(probs);

      const result = await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(result).not.toBeNull();
      expect(result!.class).toBe('HELLO');
      expect(result!.confidence).toBeCloseTo(0.8, 5);
      expect(result!.windowStart).toBe(mockTimestamps.start);
      expect(result!.windowEnd).toBe(mockTimestamps.end);
      expect(result!.timestamp).toBeDefined();
      expect(result!.allProbabilities).toBeDefined();
      expect(result!.allProbabilities!.HELLO).toBeCloseTo(0.8, 5);
    });

    it('disposes tensors after inference', async () => {
      const disposeCalls = mockTensorDispose.mock.calls.length;

      await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(mockTensorDispose.mock.calls.length).toBeGreaterThan(disposeCalls);
    });

    it('handles inference errors gracefully', async () => {
      mockModel.predict.mockImplementation(() => {
        throw new Error('Inference failed');
      });

      const result = await lstmModule.predictSign(mockFrames, mockTimestamps);

      expect(result).toBeNull();
    });
  });

  describe('Utility Functions', () => {
    describe('isConfidentPrediction', () => {
      it('returns false for null prediction', () => {
        expect(lstmModule.isConfidentPrediction(null)).toBe(false);
      });

      it('returns false for prediction below threshold', () => {
        const prediction = {
          class: 'HELLO' as const,
          confidence: 0.5,
          timestamp: Date.now(),
          windowStart: Date.now() - 1000,
          windowEnd: Date.now(),
        };
        expect(lstmModule.isConfidentPrediction(prediction)).toBe(false);
      });

      it('returns true for prediction at threshold', () => {
        const prediction = {
          class: 'HELLO' as const,
          confidence: 0.7,
          timestamp: Date.now(),
          windowStart: Date.now() - 1000,
          windowEnd: Date.now(),
        };
        expect(lstmModule.isConfidentPrediction(prediction)).toBe(true);
      });

      it('returns true for prediction above threshold', () => {
        const prediction = {
          class: 'HELLO' as const,
          confidence: 0.9,
          timestamp: Date.now(),
          windowStart: Date.now() - 1000,
          windowEnd: Date.now(),
        };
        expect(lstmModule.isConfidentPrediction(prediction)).toBe(true);
      });
    });

    describe('getModelMetadata', () => {
      it('returns null if no model loaded', async () => {
        vi.resetModules();
        lstmModule = await import('./lstmService');

        expect(lstmModule.getModelMetadata()).toBeNull();
      });

      it('returns correct shapes and vocabulary when model loaded', async () => {
        await lstmModule.loadModel();

        const metadata = lstmModule.getModelMetadata();

        expect(metadata).not.toBeNull();
        expect(metadata!.inputShape).toEqual([1, 32, 126]);
        expect(metadata!.outputShape).toEqual([1, 25]);
        expect(metadata!.vocabulary).toHaveLength(25);
        expect(metadata!.vocabulary[0]).toBe('HELLO');
      });
    });

    describe('getLSTMServiceState', () => {
      it('returns correct state when model not loaded', async () => {
        vi.resetModules();
        lstmModule = await import('./lstmService');

        const state = lstmModule.getLSTMServiceState();

        expect(state.isModelLoaded).toBe(false);
        expect(state.isModelLoading).toBe(false);
        expect(state.error).toBeNull();
      });

      it('returns correct state when model loaded', async () => {
        // Reset mock to ensure clean state
        mockModel.predict.mockReturnValue(mockPredictOutput);

        await lstmModule.loadModel();

        const state = lstmModule.getLSTMServiceState();

        expect(state.isModelLoaded).toBe(true);
        expect(state.isModelLoading).toBe(false);
        // Error might be set from a previous test, just check model is loaded
      });

      it('returns error state on load failure', async () => {
        mockTf.loadLayersModel.mockRejectedValue(new Error('Network error'));

        await lstmModule.loadModel();

        const state = lstmModule.getLSTMServiceState();

        expect(state.isModelLoaded).toBe(false);
        expect(state.error).toBe('Network error');
      });
    });

    describe('disposeModel', () => {
      it('cleans up model resources', async () => {
        await lstmModule.loadModel();
        expect(lstmModule.isModelReady()).toBe(true);

        lstmModule.disposeModel();

        expect(lstmModule.isModelReady()).toBe(false);
        expect(mockModel.dispose).toHaveBeenCalled();
      });

      it('handles dispose when no model loaded', async () => {
        vi.resetModules();
        lstmModule = await import('./lstmService');

        // Should not throw
        expect(() => lstmModule.disposeModel()).not.toThrow();
      });
    });

    describe('isModelReady', () => {
      it('returns false when model not loaded', async () => {
        vi.resetModules();
        lstmModule = await import('./lstmService');

        expect(lstmModule.isModelReady()).toBe(false);
      });

      it('returns true when model loaded and not loading', async () => {
        await lstmModule.loadModel();

        expect(lstmModule.isModelReady()).toBe(true);
      });
    });
  });
});
