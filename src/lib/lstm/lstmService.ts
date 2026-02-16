// LSTM Service for Dynamic ASL Gesture Recognition
// Uses browser LayersModel inference with API fallback when needed.

import type {
  LSTMPrediction,
  NormalizedFrame,
  LSTMModelMetadata,
  TemporalDetectorState,
} from './types';
import { windowToTensorInput } from './temporalBuffer';
import { registerAttentionLayer } from './attentionLayer';
import {
  LSTM_MODEL_PATH,
  LSTM_CONFIDENCE_THRESHOLD,
  LSTM_WINDOW_SIZE,
  LSTM_FEATURE_COUNT,
  LSTM_VOCABULARY,
  type LSTMSignClass,
} from '@/config/constants';

type TFTensorLike = {
  data: () => Promise<ArrayLike<number>>;
  dispose: () => void;
};

type TFModelLike = {
  executeAsync?: (input: unknown) => Promise<unknown>;
  predict?: (input: unknown) => unknown;
  dispose: () => void;
};

// Module-level state
let model: TFModelLike | null = null;
let isLoading = false;
let loadError: string | null = null;
let tfjs: typeof import('@tensorflow/tfjs') | null = null;
let useAPIFallback = false; // Use API when browser model unavailable

function isTensorLike(value: unknown): value is TFTensorLike {
  return (
    value !== null
    && typeof value === 'object'
    && typeof (value as { data?: unknown }).data === 'function'
    && typeof (value as { dispose?: unknown }).dispose === 'function'
  );
}

function flattenModelOutputs(output: unknown): TFTensorLike[] {
  if (isTensorLike(output)) {
    return [output];
  }

  if (Array.isArray(output)) {
    return output.filter(isTensorLike);
  }

  if (output && typeof output === 'object') {
    return Object.values(output as Record<string, unknown>).filter(isTensorLike);
  }

  return [];
}

async function runModelInference(inputTensor: { dispose: () => void }): Promise<Float32Array> {
  if (!model) {
    throw new Error('Model not loaded');
  }

  let rawOutput: unknown;

  // Layers models use predict(); graph models need executeAsync() for dynamic ops
  if (typeof model.predict === 'function') {
    rawOutput = model.predict(inputTensor);
  } else if (typeof model.executeAsync === 'function') {
    rawOutput = await model.executeAsync(inputTensor);
  } else {
    throw new Error('Loaded model does not expose predict or executeAsync');
  }

  const outputTensors = flattenModelOutputs(rawOutput);
  if (outputTensors.length === 0) {
    throw new Error('Model returned no tensor outputs');
  }

  try {
    const predictions = await outputTensors[0].data();
    return Float32Array.from(Array.from(predictions));
  } finally {
    outputTensors.forEach((tensor) => tensor.dispose());
  }
}

/**
 * Initialize TensorFlow.js and configure backend
 */
async function initTensorFlow(): Promise<typeof import('@tensorflow/tfjs')> {
  if (tfjs) return tfjs;

  // Dynamic import for Next.js compatibility
  tfjs = await import('@tensorflow/tfjs');

  // Register custom layers before loading any model
  registerAttentionLayer(tfjs);

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
 * Falls back to API endpoint if browser model unavailable
 */
export async function loadModel(): Promise<boolean> {
  if (model || useAPIFallback) {
    console.log('[LSTM] Model already loaded or using API fallback');
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
    model = await tf.loadLayersModel(LSTM_MODEL_PATH) as unknown as TFModelLike;

    // Warmup inference to compile WebGL shaders
    console.log('[LSTM] Running warmup inference...');
    const warmupInput = tf.zeros([1, LSTM_WINDOW_SIZE, LSTM_FEATURE_COUNT]);
    try {
      await runModelInference(warmupInput);
    } finally {
      warmupInput.dispose();
    }

    useAPIFallback = false;
    console.log('[LSTM] Model loaded and ready');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[LSTM] Failed to load browser model:', message);
    console.log('[LSTM] Switching to API fallback mode');
    useAPIFallback = true;
    loadError = null; // Clear error since we have a fallback
    return true; // Return true since API fallback is available
  } finally {
    isLoading = false;
  }
}

/**
 * Run LSTM inference on a window of normalized frames
 * Uses browser model or API endpoint based on availability
 */
export async function predictSign(
  normalizedFrames: NormalizedFrame[],
  windowTimestamps: { start: number; end: number }
): Promise<LSTMPrediction | null> {
  // Use API fallback if browser model not available
  if (useAPIFallback) {
    return predictSignViaAPI(normalizedFrames, windowTimestamps);
  }

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

    let predictions: Float32Array;
    try {
      predictions = await runModelInference(inputTensor);
    } finally {
      inputTensor.dispose();
    }

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

    const predictedClass = (LSTM_VOCABULARY[maxIndex] || LSTM_VOCABULARY[0]) as LSTMSignClass;

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
 * Run LSTM inference via API endpoint
 */
async function predictSignViaAPI(
  normalizedFrames: NormalizedFrame[],
  windowTimestamps: { start: number; end: number }
): Promise<LSTMPrediction | null> {
  try {
    // Convert frames to raw landmark arrays
    const landmarks = normalizedFrames.map(frame => frame.features);

    const response = await fetch('/api/lstm/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landmarks }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[LSTM API] Prediction failed:', error);
      return null;
    }

    const result = await response.json();

    // Convert API response to LSTMPrediction format
    const allProbabilities: Record<string, number> = {};
    result.top3?.forEach((item: { sign: string; confidence: number }) => {
      allProbabilities[item.sign] = item.confidence;
    });

    const prediction: LSTMPrediction = {
      class: result.sign as LSTMSignClass,
      confidence: result.confidence,
      timestamp: Date.now(),
      windowStart: windowTimestamps.start,
      windowEnd: windowTimestamps.end,
      allProbabilities,
    };

    console.log(
      `[LSTM API] Prediction: ${result.sign} (${(result.confidence * 100).toFixed(1)}%)`
    );

    return prediction;
  } catch (error) {
    console.error('[LSTM API] Request failed:', error);
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
> & { useAPIFallback: boolean } {
  return {
    isModelLoaded: model !== null || useAPIFallback,
    isModelLoading: isLoading,
    error: loadError,
    useAPIFallback,
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
  return (model !== null || useAPIFallback) && !isLoading;
}

/**
 * Check if using API fallback mode
 */
export function isUsingAPIFallback(): boolean {
  return useAPIFallback;
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
