import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/constants', () => ({
  LSTM_WINDOW_SIZE: 16,
  LSTM_STRIDE: 8,
  LSTM_MIN_MOTION_FRAMES: 4,
  LSTM_FEATURE_COUNT: 63,
  LSTM_CONFIDENCE_THRESHOLD: 0.7,
  LSTM_MODEL_PATH: '/models/asl_cnn_lstm_25.json',
  LSTM_VOCABULARY: [
    'HELLO', 'PLEASE', 'THANK_YOU', 'LIKE', 'WHERE',
    'WHO', 'WHY', 'YES', 'NO', 'BAD', 'FINISH',
    'GOODBYE', 'GOOD', 'NEED', 'CLEAN', 'FOOD',
    'DRINK', 'WATER', 'BATHROOM',
    'SORRY', 'HELP', 'UNDERSTAND', 'WANT', 'NAME',
    'WHAT', 'WHEN', 'HOW', 'MEET', 'AGAIN',
  ],
  MIN_MOTION_THRESHOLD: 0.023,
}));

const mockTensorDispose = vi.fn();
const mockOutputTensor = {
  data: vi.fn().mockResolvedValue(new Float32Array(29).fill(0.01)),
  dispose: mockTensorDispose,
};
const mockModel = {
  executeAsync: vi.fn().mockResolvedValue(mockOutputTensor),
  predict: vi.fn().mockReturnValue(mockOutputTensor),
  dispose: vi.fn(),
};
const mockTensor = { dispose: mockTensorDispose };
const mockTf = {
  setBackend: vi.fn().mockResolvedValue(undefined),
  ready: vi.fn().mockResolvedValue(undefined),
  loadLayersModel: vi.fn().mockResolvedValue(mockModel),
  tensor3d: vi.fn().mockReturnValue(mockTensor),
  zeros: vi.fn().mockReturnValue(mockTensor),
  layers: { Layer: class Layer { static className = 'Layer'; } },
  serialization: { registerClass: vi.fn() },
  initializers: { glorotUniform: vi.fn(), zeros: vi.fn() },
};

vi.mock('@tensorflow/tfjs', () => mockTf);

let lstmModule: typeof import('./lstmService');

describe('lstmService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockTf.setBackend.mockResolvedValue(undefined);
    mockTf.ready.mockResolvedValue(undefined);
    mockTf.loadLayersModel.mockResolvedValue(mockModel);
    mockOutputTensor.data.mockResolvedValue(new Float32Array(29).fill(0.01));
    mockModel.executeAsync.mockResolvedValue(mockOutputTensor);
    mockModel.predict.mockReturnValue(mockOutputTensor);
    lstmModule = await import('./lstmService');
  });

  afterEach(() => {
    lstmModule.disposeModel();
  });

  it('loads layers model from configured path and runs warmup inference', async () => {
    const ok = await lstmModule.loadModel();

    expect(ok).toBe(true);
    expect(mockTf.loadLayersModel).toHaveBeenCalledWith('/models/asl_cnn_lstm_25.json');
    expect(mockTf.zeros).toHaveBeenCalledWith([1, 16, 63]);
    expect(mockModel.predict).toHaveBeenCalled();
  });

  it('falls back to API mode if layers model fails to load', async () => {
    mockTf.loadLayersModel.mockRejectedValue(new Error('cannot load'));

    const ok = await lstmModule.loadModel();
    const state = lstmModule.getLSTMServiceState();

    expect(ok).toBe(true);
    expect(state.isModelLoaded).toBe(true);
    expect(state.useAPIFallback).toBe(true);
    expect(state.error).toBeNull();
  });

  it('creates [1,16,63] tensor input and maps probabilities to vocabulary', async () => {
    await lstmModule.loadModel();
    const probs = new Float32Array(29).fill(0.01);
    probs[20] = 0.9; // HELP
    mockOutputTensor.data.mockResolvedValue(probs);

    const frames = Array(16).fill(null).map(() => ({
      features: Array(63).fill(0.2),
      hasMotion: true,
    }));
    const prediction = await lstmModule.predictSign(frames, { start: 1, end: 2 });

    expect(mockTf.tensor3d).toHaveBeenCalled();
    const tensorInput = mockTf.tensor3d.mock.calls[0][0];
    expect(tensorInput).toHaveLength(1);
    expect(tensorInput[0]).toHaveLength(16);
    expect(tensorInput[0][0]).toHaveLength(63);

    expect(prediction).not.toBeNull();
    expect(prediction!.class).toBe('HELP');
    expect(prediction!.confidence).toBeCloseTo(0.9, 5);
    expect(prediction!.allProbabilities?.HELP).toBeCloseTo(0.9, 5);
  });

  it('returns null when predict throws', async () => {
    await lstmModule.loadModel();
    mockModel.predict.mockImplementation(() => { throw new Error('predict failed'); });

    const frames = Array(16).fill(null).map(() => ({
      features: Array(63).fill(0.2),
      hasMotion: true,
    }));
    const prediction = await lstmModule.predictSign(frames, { start: 1, end: 2 });

    expect(prediction).toBeNull();
  });

  it('returns null when model is unavailable and not in API fallback mode', async () => {
    const fresh = await import('./lstmService');
    const frames = Array(16).fill(null).map(() => ({
      features: Array(63).fill(0.2),
      hasMotion: true,
    }));
    const prediction = await fresh.predictSign(frames, { start: 1, end: 2 });

    expect(prediction).toBeNull();
  });

  it('returns metadata using current input/output dimensions', async () => {
    await lstmModule.loadModel();

    const metadata = lstmModule.getModelMetadata();

    expect(metadata).not.toBeNull();
    expect(metadata!.inputShape).toEqual([1, 16, 63]);
    expect(metadata!.outputShape).toEqual([1, 29]);
    expect(metadata!.vocabulary).toHaveLength(29);
  });

  it('applies confidence threshold helper correctly', () => {
    expect(lstmModule.isConfidentPrediction(null)).toBe(false);
    expect(
      lstmModule.isConfidentPrediction({
        class: 'HELLO',
        confidence: 0.69,
        timestamp: Date.now(),
        windowStart: Date.now() - 1,
        windowEnd: Date.now(),
      })
    ).toBe(false);
    expect(
      lstmModule.isConfidentPrediction({
        class: 'HELLO',
        confidence: 0.7,
        timestamp: Date.now(),
        windowStart: Date.now() - 1,
        windowEnd: Date.now(),
      })
    ).toBe(true);
  });
});
