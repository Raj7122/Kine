// Hybrid detection system orchestrating Roboflow YOLO + MediaPipe + LSTM

import {
  detectSign,
  captureFrameAsBase64,
  shouldCallAPI,
  isRoboflowConfigured,
  RoboflowDetection,
} from '../roboflow';
import {
  HybridDetectionResult,
  HybridDetectorState,
  DetectionHistory,
  FusionOutput,
  DetectionMode,
} from './types';
import {
  fuseDetections,
  fuseWithLSTM,
  getBestDetection,
  createDetectionHistory,
  addToHistory,
} from './confidenceFusion';
import type { LSTMPrediction } from '../lstm/types';
import {
  ROBOFLOW_TEMPORAL_WINDOW,
  LSTM_CONFIDENCE_THRESHOLD,
} from '@/config/constants';

// Module-level state
let state: HybridDetectorState = {
  isEnabled: false,
  lastRoboflowResult: null,
  lastLSTMPrediction: null,
  lastFusionOutput: null,
  history: createDetectionHistory(ROBOFLOW_TEMPORAL_WINDOW * 2),
  isProcessing: false,
  detectionMode: 'HYBRID',
  isLSTMEnabled: false,
};

/**
 * Initialize the hybrid detector
 * @param enableRoboflow Whether to enable Roboflow API calls
 * @param enableLSTM Whether to enable LSTM dynamic gesture detection
 * @param mode Detection mode: STATIC (YOLO only), DYNAMIC (LSTM only), HYBRID (both)
 */
export function initHybridDetector(
  enableRoboflow: boolean = true,
  enableLSTM: boolean = true,
  mode: DetectionMode = 'HYBRID'
): void {
  const roboflowAvailable = isRoboflowConfigured();

  state = {
    isEnabled: enableRoboflow && roboflowAvailable,
    lastRoboflowResult: null,
    lastLSTMPrediction: null,
    lastFusionOutput: null,
    history: createDetectionHistory(ROBOFLOW_TEMPORAL_WINDOW * 2),
    isProcessing: false,
    detectionMode: mode,
    isLSTMEnabled: enableLSTM,
  };

  if (enableRoboflow && !roboflowAvailable) {
    console.warn('Roboflow requested but not configured. Running in MediaPipe-only mode.');
  }

  console.log(
    `Hybrid detector initialized. Roboflow: ${state.isEnabled ? 'enabled' : 'disabled'}, ` +
    `LSTM: ${state.isLSTMEnabled ? 'enabled' : 'disabled'}, Mode: ${mode}`
  );
}

/**
 * Process a video frame through the hybrid detection system
 * @param video HTMLVideoElement to process
 * @param motionMagnitude Current motion magnitude (0-1)
 * @param mediapipeActive Whether MediaPipe is currently detecting
 * @param lstmPrediction Optional LSTM prediction from parallel processing
 */
export async function processFrame(
  video: HTMLVideoElement,
  motionMagnitude: number,
  mediapipeActive: boolean,
  lstmPrediction?: LSTMPrediction | null
): Promise<HybridDetectionResult> {
  const timestamp = Date.now();

  // Update LSTM prediction if provided
  if (lstmPrediction !== undefined) {
    state.lastLSTMPrediction = lstmPrediction;
  }

  // Default result with no detection
  let result: HybridDetectionResult = {
    roboflowDetections: [],
    lstmPrediction: state.lastLSTMPrediction,
    fusionOutput: { action: 'rely_gemini', hint: null },
    mediapipeActive,
    timestamp,
    detectionMode: state.detectionMode,
  };

  // Skip Roboflow if disabled or already processing, or in DYNAMIC-only mode
  const shouldRunRoboflow =
    state.isEnabled &&
    !state.isProcessing &&
    state.detectionMode !== 'DYNAMIC';

  if (!shouldRunRoboflow) {
    // Still fuse with LSTM if available
    if (state.isLSTMEnabled && state.lastLSTMPrediction) {
      const fusionOutput = fuseWithLSTM(
        null,
        state.lastLSTMPrediction,
        state.history,
        motionMagnitude
      );
      state.lastFusionOutput = fusionOutput;

      return {
        roboflowDetections: state.lastRoboflowResult || [],
        lstmPrediction: state.lastLSTMPrediction,
        fusionOutput,
        mediapipeActive,
        timestamp,
        detectionMode: state.detectionMode,
      };
    }

    // Return last result if we have one
    if (state.lastRoboflowResult && state.lastFusionOutput) {
      return {
        roboflowDetections: state.lastRoboflowResult,
        lstmPrediction: state.lastLSTMPrediction,
        fusionOutput: state.lastFusionOutput,
        mediapipeActive,
        timestamp,
        detectionMode: state.detectionMode,
      };
    }
    return result;
  }

  // Check if we should call the Roboflow API based on rate limiting and motion
  if (!shouldCallAPI(motionMagnitude)) {
    // Still fuse with LSTM if available
    if (state.isLSTMEnabled && state.lastLSTMPrediction) {
      const fusionOutput = fuseWithLSTM(
        state.lastRoboflowResult ? getBestDetection(state.lastRoboflowResult) : null,
        state.lastLSTMPrediction,
        state.history,
        motionMagnitude
      );
      state.lastFusionOutput = fusionOutput;

      return {
        roboflowDetections: state.lastRoboflowResult || [],
        lstmPrediction: state.lastLSTMPrediction,
        fusionOutput,
        mediapipeActive,
        timestamp,
        detectionMode: state.detectionMode,
      };
    }

    // Return last result if we have one
    if (state.lastRoboflowResult && state.lastFusionOutput) {
      return {
        roboflowDetections: state.lastRoboflowResult,
        lstmPrediction: state.lastLSTMPrediction,
        fusionOutput: state.lastFusionOutput,
        mediapipeActive,
        timestamp,
        detectionMode: state.detectionMode,
      };
    }
    return result;
  }

  state.isProcessing = true;

  try {
    // Capture frame and send to Roboflow API
    const imageBase64 = captureFrameAsBase64(video);
    const detections = await detectSign(imageBase64);

    state.lastRoboflowResult = detections;

    // Get best detection and update history
    const bestDetection = getBestDetection(detections);

    if (bestDetection) {
      state.history = addToHistory(state.history, bestDetection);
    }

    // Fuse detections with LSTM and history
    let fusionOutput: FusionOutput;

    if (state.isLSTMEnabled) {
      fusionOutput = fuseWithLSTM(
        bestDetection,
        state.lastLSTMPrediction,
        state.history,
        motionMagnitude
      );
    } else {
      fusionOutput = fuseDetections(bestDetection, state.history);
    }

    state.lastFusionOutput = fusionOutput;

    result = {
      roboflowDetections: detections,
      lstmPrediction: state.lastLSTMPrediction,
      fusionOutput,
      mediapipeActive,
      timestamp,
      detectionMode: state.detectionMode,
    };
  } catch (error) {
    console.error('Hybrid detection error:', error);
  } finally {
    state.isProcessing = false;
  }

  return result;
}

/**
 * Get the current hybrid detector state
 */
export function getHybridDetectorState(): HybridDetectorState {
  return { ...state };
}

/**
 * Enable or disable Roboflow detection
 */
export function setRoboflowEnabled(enabled: boolean): void {
  if (enabled && !isRoboflowConfigured()) {
    console.warn('Cannot enable Roboflow: not configured');
    return;
  }
  state.isEnabled = enabled;
  console.log(`Roboflow detection ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Clear detection history
 */
export function clearHistory(): void {
  state.history = createDetectionHistory(ROBOFLOW_TEMPORAL_WINDOW * 2);
  state.lastRoboflowResult = null;
  state.lastLSTMPrediction = null;
  state.lastFusionOutput = null;
}

/**
 * Enable or disable LSTM detection
 */
export function setLSTMEnabled(enabled: boolean): void {
  state.isLSTMEnabled = enabled;
  if (!enabled) {
    state.lastLSTMPrediction = null;
  }
  console.log(`LSTM detection ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Set detection mode
 */
export function setDetectionMode(mode: DetectionMode): void {
  state.detectionMode = mode;
  console.log(`Detection mode set to: ${mode}`);
}

/**
 * Get last LSTM prediction
 */
export function getLastLSTMPrediction(): LSTMPrediction | null {
  return state.lastLSTMPrediction;
}

/**
 * Update LSTM prediction externally (from useLSTMDetection hook)
 */
export function updateLSTMPrediction(prediction: LSTMPrediction | null): void {
  state.lastLSTMPrediction = prediction;
}

/**
 * Get the last fusion output (for use by translation service)
 */
export function getLastFusionOutput(): FusionOutput | null {
  return state.lastFusionOutput;
}

/**
 * Get all current Roboflow detections (for rendering bounding boxes)
 */
export function getCurrentDetections(): RoboflowDetection[] {
  return state.lastRoboflowResult || [];
}

/**
 * Get detection history for debugging/analysis
 */
export function getDetectionHistory(): DetectionHistory {
  return { ...state.history };
}

// Expose functions to window for browser console testing
if (typeof window !== 'undefined') {
  const windowWithDebug = window as unknown as {
    getHybridDetectionState: typeof getHybridDetectorState;
    setRoboflowEnabled: typeof setRoboflowEnabled;
    setLSTMEnabled: typeof setLSTMEnabled;
    setDetectionMode: typeof setDetectionMode;
    clearDetectionHistory: typeof clearHistory;
    getLastLSTMPrediction: typeof getLastLSTMPrediction;
  };

  windowWithDebug.getHybridDetectionState = getHybridDetectorState;
  windowWithDebug.setRoboflowEnabled = setRoboflowEnabled;
  windowWithDebug.setLSTMEnabled = setLSTMEnabled;
  windowWithDebug.setDetectionMode = setDetectionMode;
  windowWithDebug.clearDetectionHistory = clearHistory;
  windowWithDebug.getLastLSTMPrediction = getLastLSTMPrediction;
}
