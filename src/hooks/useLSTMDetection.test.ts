import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { HandLandmarkResult, Landmark } from '@/lib/mediapipe/types';
import type { LSTMPrediction } from '@/lib/lstm/types';

// Mock constants
vi.mock('@/config/constants', () => ({
  LSTM_WINDOW_SIZE: 32,
  LSTM_STRIDE: 15,
  LSTM_MIN_MOTION_FRAMES: 8,
  LSTM_FEATURE_COUNT: 126,
  LSTM_CONFIDENCE_THRESHOLD: 0.7,
  LSTM_MODEL_PATH: '/models/asl_lstm_25.json',
  LSTM_VOCABULARY: ['HELLO', 'GOODBYE', 'PLEASE', 'THANK_YOU', 'SORRY'],
  MIN_MOTION_THRESHOLD: 0.023,
}));

// Create mock buffer methods outside factory
const mockBufferMethods = {
  addFrame: vi.fn(),
  getWindowForInference: vi.fn(),
  getWindowTimestamps: vi.fn(),
  getState: vi.fn(),
  clear: vi.fn(),
};

// Mock LSTM module with factory function
vi.mock('@/lib/lstm', () => {
  // Create a mock class that can be instantiated with `new`
  class MockTemporalBuffer {
    addFrame = mockBufferMethods.addFrame;
    getWindowForInference = mockBufferMethods.getWindowForInference;
    getWindowTimestamps = mockBufferMethods.getWindowTimestamps;
    getState = mockBufferMethods.getState;
    clear = mockBufferMethods.clear;
  }

  return {
    TemporalBuffer: MockTemporalBuffer,
    loadModel: vi.fn().mockResolvedValue(true),
    predictSign: vi.fn().mockResolvedValue(null),
    isConfidentPrediction: vi.fn().mockReturnValue(false),
    getLSTMServiceState: vi.fn().mockReturnValue({
      isModelLoaded: false,
      isModelLoading: false,
      error: null,
    }),
    disposeModel: vi.fn(),
    isModelReady: vi.fn().mockReturnValue(false),
  };
});

// Import the module after mocks are set up
import { useLSTMDetection } from './useLSTMDetection';
import * as lstmModule from '@/lib/lstm';

// Helper to create mock hand result
function createMockHandResult(): HandLandmarkResult {
  const landmarks: Landmark[] = Array(21).fill(null).map((_, i) => ({
    x: 0.5 + i * 0.01,
    y: 0.5 + i * 0.01,
    z: 0,
  }));

  return {
    landmarks: [landmarks],
    worldLandmarks: [landmarks],
    handedness: [[{ categoryName: 'Right', score: 0.99 }]],
  };
}

// Helper to create mock LSTM prediction
function createMockPrediction(
  className: string = 'HELLO',
  confidence: number = 0.85
): LSTMPrediction {
  return {
    class: className as LSTMPrediction['class'],
    confidence,
    timestamp: Date.now(),
    windowStart: Date.now() - 1000,
    windowEnd: Date.now(),
  };
}

// Get typed access to mock functions
const mockLoadModel = lstmModule.loadModel as Mock;
const mockPredictSign = lstmModule.predictSign as Mock;
const mockIsConfidentPrediction = lstmModule.isConfidentPrediction as Mock;
const mockGetLSTMServiceState = lstmModule.getLSTMServiceState as Mock;
const mockIsModelReady = lstmModule.isModelReady as Mock;
// Use the mock buffer methods defined outside the factory
const mockBuffer = mockBufferMethods;

describe('useLSTMDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockLoadModel.mockResolvedValue(true);
    mockPredictSign.mockResolvedValue(null);
    mockIsConfidentPrediction.mockReturnValue(false);
    mockGetLSTMServiceState.mockReturnValue({
      isModelLoaded: false,
      isModelLoading: false,
      error: null,
    });
    mockIsModelReady.mockReturnValue(false);
    mockBuffer.addFrame.mockReturnValue({
      shouldInfer: false,
      window: null,
      reason: 'not_ready',
    });
    mockBuffer.getState.mockReturnValue({
      frames: [],
      framesSinceLastInference: 0,
      isBufferFull: false,
      motionFramesInWindow: 0,
    });
    mockBuffer.getWindowForInference.mockReturnValue(null);
    mockBuffer.getWindowTimestamps.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Hook Initialization', () => {
    it('initializes with correct default state values', () => {
      const { result } = renderHook(() => useLSTMDetection());

      expect(result.current.isEnabled).toBe(false);
      expect(result.current.isModelLoaded).toBe(false);
      expect(result.current.isModelLoading).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.lastPrediction).toBeNull();
      expect(result.current.predictionHistory).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('does not load model on mount when autoLoad=false', () => {
      renderHook(() => useLSTMDetection({ autoLoad: false }));

      expect(mockLoadModel).not.toHaveBeenCalled();
    });

    it('loads model on mount when autoLoad=true', async () => {
      renderHook(() => useLSTMDetection({ autoLoad: true }));

      await waitFor(() => {
        expect(mockLoadModel).toHaveBeenCalled();
      });
    });
  });

  describe('Enable/Disable', () => {
    it('enable() loads model if not loaded', async () => {
      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      expect(mockLoadModel).toHaveBeenCalled();
    });

    it('enable() sets isEnabled=true after successful load', async () => {
      mockLoadModel.mockResolvedValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      expect(result.current.isEnabled).toBe(true);
    });

    it('enable() handles load failure', async () => {
      mockLoadModel.mockResolvedValue(false);
      mockGetLSTMServiceState.mockReturnValue({
        isModelLoaded: false,
        isModelLoading: false,
        error: 'Failed to load',
      });

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      expect(result.current.isEnabled).toBe(false);
    });

    it('disable() sets isEnabled=false', async () => {
      mockLoadModel.mockResolvedValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      act(() => {
        result.current.disable();
      });

      expect(result.current.isEnabled).toBe(false);
    });

    it('disable() clears the buffer', async () => {
      mockLoadModel.mockResolvedValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      act(() => {
        result.current.disable();
      });

      expect(mockBuffer.clear).toHaveBeenCalled();
    });
  });

  describe('Process Landmarks', () => {
    it('skips processing when disabled', async () => {
      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(mockBuffer.addFrame).not.toHaveBeenCalled();
    });

    it('skips processing when model not ready', async () => {
      mockIsModelReady.mockReturnValue(false);
      mockLoadModel.mockResolvedValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(mockBuffer.addFrame).not.toHaveBeenCalled();
    });

    it('adds frame to buffer when enabled and model ready', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      const handResult = createMockHandResult();
      await act(async () => {
        await result.current.processLandmarks(handResult);
      });

      expect(mockBuffer.addFrame).toHaveBeenCalledWith(handResult);
    });

    it('runs inference when shouldInfer=true', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      const mockFrames = [{ features: Array(126).fill(0), hasMotion: true }];
      mockBuffer.getWindowForInference.mockReturnValue(mockFrames);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(mockPredictSign).toHaveBeenCalled();
    });

    it('filters by confidence threshold', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const lowConfPrediction = createMockPrediction('HELLO', 0.5);
      mockPredictSign.mockResolvedValue(lowConfPrediction);
      mockIsConfidentPrediction.mockReturnValue(false);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      // Low confidence prediction should not update lastPrediction
      expect(result.current.lastPrediction).toBeNull();
    });

    it('updates lastPrediction for confident predictions', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const prediction = createMockPrediction('HELLO', 0.85);
      mockPredictSign.mockResolvedValue(prediction);
      mockIsConfidentPrediction.mockReturnValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(result.current.lastPrediction).toEqual(prediction);
    });

    it('updates predictionHistory', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const prediction = createMockPrediction('HELLO', 0.85);
      mockPredictSign.mockResolvedValue(prediction);
      mockIsConfidentPrediction.mockReturnValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(result.current.predictionHistory).toHaveLength(1);
      expect(result.current.predictionHistory[0]).toEqual(prediction);
    });

    it('respects maxHistorySize limit', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });
      mockIsConfidentPrediction.mockReturnValue(true);

      const { result } = renderHook(() =>
        useLSTMDetection({ maxHistorySize: 3 })
      );

      await act(async () => {
        await result.current.enable();
      });

      // Add more predictions than maxHistorySize
      for (let i = 0; i < 5; i++) {
        mockPredictSign.mockResolvedValue(createMockPrediction('HELLO', 0.85));
        await act(async () => {
          await result.current.processLandmarks(createMockHandResult());
        });
      }

      expect(result.current.predictionHistory.length).toBeLessThanOrEqual(3);
    });

    it('calls onPrediction callback', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const prediction = createMockPrediction('HELLO', 0.85);
      mockPredictSign.mockResolvedValue(prediction);
      mockIsConfidentPrediction.mockReturnValue(true);

      const onPrediction = vi.fn();
      const { result } = renderHook(() =>
        useLSTMDetection({ onPrediction })
      );

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      expect(onPrediction).toHaveBeenCalledWith(prediction);
    });
  });

  describe('State Management', () => {
    it('reset() clears all state', async () => {
      mockLoadModel.mockResolvedValue(true);
      mockIsModelReady.mockReturnValue(true);
      mockBuffer.addFrame.mockReturnValue({
        shouldInfer: true,
        window: [],
        reason: 'stride_reached',
      });
      mockBuffer.getWindowForInference.mockReturnValue([]);
      mockBuffer.getWindowTimestamps.mockReturnValue({
        start: Date.now() - 1000,
        end: Date.now(),
      });

      const prediction = createMockPrediction('HELLO', 0.85);
      mockPredictSign.mockResolvedValue(prediction);
      mockIsConfidentPrediction.mockReturnValue(true);

      const { result } = renderHook(() => useLSTMDetection());

      await act(async () => {
        await result.current.enable();
      });

      await act(async () => {
        await result.current.processLandmarks(createMockHandResult());
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.lastPrediction).toBeNull();
      expect(result.current.predictionHistory).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(mockBuffer.clear).toHaveBeenCalled();
    });

    it('getState() returns complete state', () => {
      const { result } = renderHook(() => useLSTMDetection());

      const state = result.current.getState();

      expect(state).toMatchObject({
        isModelLoaded: expect.any(Boolean),
        isModelLoading: expect.any(Boolean),
        isProcessing: expect.any(Boolean),
        lastPrediction: null,
        predictionHistory: [],
        currentMode: 'DYNAMIC',
        frameCount: expect.any(Number),
        motionFrameCount: expect.any(Number),
        error: null,
      });
    });
  });
});
