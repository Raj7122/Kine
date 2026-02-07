// LSTM Service for Dynamic ASL Gesture Recognition
// Uses TensorFlow.js for in-browser inference

import type {
  LSTMPrediction,
  NormalizedFrame,
  LSTMModelMetadata,
  TemporalDetectorState,
} from './types';
import { windowToTensorInput } from './temporalBuffer';
import {
  LSTM_MODEL_PATH,
  LSTM_CONFIDENCE_THRESHOLD,
  LSTM_WINDOW_SIZE,
  LSTM_FEATURE_COUNT,
  LSTM_VOCABULARY,
  type LSTMSignClass,
} from '@/config/constants';

// TensorFlow.js types - we'll dynamically import to avoid SSR issues
type TFLayersModel = {
  predict: (input: unknown) => { data: () => Promise<Float32Array>; dispose: () => void };
  dispose: () => void;
};

// Module-level state
let model: TFLayersModel | null = null;
let isLoading = false;
let loadError: string | null = null;
let tfjs: typeof import('@tensorflow/tfjs') | null = null;

/**
 * Initialize TensorFlow.js and configure backend
 */
async function initTensorFlow(): Promise<typeof import('@tensorflow/tfjs')> {
  if (tfjs) return tfjs;

  // Dynamic import for Next.js compatibility
  tfjs = await import('@tensorflow/tfjs');

  // Try WebGL backend first for GPU acceleration
  try {
    await tfjs.setBackend('webgl');
    await tfjs.ready();
    console.log('[LSTM] TensorFlow.js initialized with WebGL backend');
  } catch {
    // Fall back to CPU if WebGL unavailable
    console.warn('[LSTM] WebGL unavailable, falling back to CPU backend');
    await tfjs.setBackend('cpu');
    await tfjs.ready();
  }

  return tfjs;
}

/**
 * Load the LSTM model from public directory
 */
export async function loadModel(): Promise<boolean> {
  if (model) {
    console.log('[LSTM] Model already loaded');
    return true;
  }

  if (isLoading) {
    console.log('[LSTM] Model loading in progress...');
    return false;
  }

  isLoading = true;
  loadError = null;

  try {
    const tf = await initTensorFlow();

    console.log('[LSTM] Loading model from:', LSTM_MODEL_PATH);
    model = await tf.loadLayersModel(LSTM_MODEL_PATH) as unknown as TFLayersModel;

    // Warmup inference to compile WebGL shaders
    console.log('[LSTM] Running warmup inference...');
    const warmupInput = tf.zeros([1, LSTM_WINDOW_SIZE, LSTM_FEATURE_COUNT]);
    const warmupResult = model.predict(warmupInput);
    (warmupResult as { dispose: () => void }).dispose();
    warmupInput.dispose();

    console.log('[LSTM] Model loaded and ready');
    isLoading = false;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LSTM] Failed to load model:', message);
    loadError = message;
    isLoading = false;
    return false;
  }
}

/**
 * Run LSTM inference on a window of normalized frames
 */
export async function predictSign(
  normalizedFrames: NormalizedFrame[],
  windowTimestamps: { start: number; end: number }
): Promise<LSTMPrediction | null> {
  if (!model) {
    console.warn('[LSTM] Model not loaded, cannot predict');
    return null;
  }

  if (!tfjs) {
    console.warn('[LSTM] TensorFlow.js not initialized');
    return null;
  }

  try {
    // Convert frames to tensor input format
    const inputData = windowToTensorInput(normalizedFrames, LSTM_WINDOW_SIZE, LSTM_FEATURE_COUNT);

    // Create tensor
    const inputTensor = tfjs.tensor3d(inputData);

    // Run inference
    const outputTensor = model.predict(inputTensor);

    // Get predictions
    const predictions = await (outputTensor as { data: () => Promise<Float32Array> }).data();

    // Clean up tensors
    inputTensor.dispose();
    (outputTensor as { dispose: () => void }).dispose();

    // Find best prediction
    let maxProb = 0;
    let maxIndex = 0;
    const allProbabilities: Record<string, number> = {};

    for (let i = 0; i < predictions.length; i++) {
      const prob = predictions[i];
      const className = LSTM_VOCABULARY[i];

      if (className) {
        allProbabilities[className] = prob;
      }

      if (prob > maxProb) {
        maxProb = prob;
        maxIndex = i;
      }
    }

    const predictedClass = LSTM_VOCABULARY[maxIndex] as LSTMSignClass;

    const prediction: LSTMPrediction = {
      class: predictedClass,
      confidence: maxProb,
      timestamp: Date.now(),
      windowStart: windowTimestamps.start,
      windowEnd: windowTimestamps.end,
      allProbabilities,
    };

    console.log(
      `[LSTM] Prediction: ${predictedClass} (${(maxProb * 100).toFixed(1)}%)`
    );

    return prediction;
  } catch (error) {
    console.error('[LSTM] Inference error:', error);
    return null;
  }
}

/**
 * Check if prediction meets confidence threshold
 */
export function isConfidentPrediction(prediction: LSTMPrediction | null): boolean {
  return prediction !== null && prediction.confidence >= LSTM_CONFIDENCE_THRESHOLD;
}

/**
 * Get model metadata (for debugging/display)
 */
export function getModelMetadata(): LSTMModelMetadata | null {
  if (!model) return null;

  return {
    inputShape: [1, LSTM_WINDOW_SIZE, LSTM_FEATURE_COUNT],
    outputShape: [1, LSTM_VOCABULARY.length],
    vocabulary: [...LSTM_VOCABULARY],
  };
}

/**
 * Get current service state
 */
export function getLSTMServiceState(): Pick<
  TemporalDetectorState,
  'isModelLoaded' | 'isModelLoading' | 'error'
> {
  return {
    isModelLoaded: model !== null,
    isModelLoading: isLoading,
    error: loadError,
  };
}

/**
 * Dispose of the model and free memory
 */
export function disposeModel(): void {
  if (model) {
    model.dispose();
    model = null;
    console.log('[LSTM] Model disposed');
  }
}

/**
 * Check if model is ready for inference
 */
export function isModelReady(): boolean {
  return model !== null && !isLoading;
}

// Browser console testing utilities
if (typeof window !== 'undefined') {
  const windowWithDebug = window as unknown as {
    testLSTMInference: () => Promise<void>;
    getLSTMState: () => ReturnType<typeof getLSTMServiceState>;
    loadLSTMModel: () => Promise<boolean>;
    disposeLSTMModel: () => void;
    getLSTMModelMetadata: () => ReturnType<typeof getModelMetadata>;
  };

  windowWithDebug.testLSTMInference = async () => {
    if (!model) {
      console.log('Loading model first...');
      await loadModel();
    }

    // Create dummy input for testing
    const dummyFrames: NormalizedFrame[] = Array(LSTM_WINDOW_SIZE)
      .fill(null)
      .map(() => ({
        features: Array(LSTM_FEATURE_COUNT).fill(0).map(() => Math.random() * 0.1),
        hasMotion: true,
      }));

    const result = await predictSign(dummyFrames, {
      start: Date.now() - 1000,
      end: Date.now(),
    });

    console.log('Test inference result:', result);
  };

  windowWithDebug.getLSTMState = getLSTMServiceState;
  windowWithDebug.loadLSTMModel = loadModel;
  windowWithDebug.disposeLSTMModel = disposeModel;
  windowWithDebug.getLSTMModelMetadata = getModelMetadata;
}
