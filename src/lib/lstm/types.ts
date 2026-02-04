// LSTM Dynamic Gesture Recognition Types

import type { LSTMSignClass } from '@/config/constants';

/**
 * Single landmark frame with all hand data flattened
 */
export interface LandmarkFrame {
  timestamp: number;
  landmarks: number[];     // 126 features flattened (21 × 3 × 2)
  hasLeftHand: boolean;
  hasRightHand: boolean;
  motionMagnitude: number; // For motion-aware buffering
}

/**
 * Normalized landmark frame ready for LSTM input
 */
export interface NormalizedFrame {
  features: number[];      // Normalized 126 features
  hasMotion: boolean;
}

/**
 * LSTM model prediction result
 */
export interface LSTMPrediction {
  class: LSTMSignClass;    // Predicted sign class
  confidence: number;      // 0-1 confidence score
  timestamp: number;       // When prediction was made
  windowStart: number;     // Start timestamp of input window
  windowEnd: number;       // End timestamp of input window
  allProbabilities?: Record<string, number>; // All class probabilities
}

/**
 * State of the temporal detector system
 */
export interface TemporalDetectorState {
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isProcessing: boolean;
  lastPrediction: LSTMPrediction | null;
  predictionHistory: LSTMPrediction[];
  currentMode: 'STATIC' | 'DYNAMIC' | 'HYBRID';
  frameCount: number;        // Total frames processed
  motionFrameCount: number;  // Frames with significant motion
  error: string | null;
}

/**
 * Configuration for LSTM inference
 */
export interface LSTMConfig {
  windowSize: number;
  stride: number;
  minMotionFrames: number;
  confidenceThreshold: number;
  modelPath: string;
  featureCount: number;
}

/**
 * Buffer state for temporal processing
 */
export interface TemporalBufferState {
  frames: LandmarkFrame[];
  framesSinceLastInference: number;
  isBufferFull: boolean;
  motionFramesInWindow: number;
}

/**
 * Result from temporal buffer processing
 */
export interface BufferProcessResult {
  shouldInfer: boolean;
  window: LandmarkFrame[] | null;
  reason: 'stride_reached' | 'buffer_full' | 'not_ready' | 'insufficient_motion';
}

/**
 * Model metadata from TensorFlow.js
 */
export interface LSTMModelMetadata {
  inputShape: number[];
  outputShape: number[];
  vocabulary: string[];
  trainedAt?: string;
  accuracy?: number;
}
