// Hybrid detection system orchestrating Roboflow YOLO + MediaPipe

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
} from './types';
import {
  fuseDetections,
  getBestDetection,
  createDetectionHistory,
  addToHistory,
} from './confidenceFusion';
import { ROBOFLOW_TEMPORAL_WINDOW } from '@/config/constants';

// Module-level state
let state: HybridDetectorState = {
  isEnabled: false,
  lastRoboflowResult: null,
  lastFusionOutput: null,
  history: createDetectionHistory(ROBOFLOW_TEMPORAL_WINDOW * 2),
  isProcessing: false,
};

/**
 * Initialize the hybrid detector
 * @param enableRoboflow Whether to enable Roboflow API calls
 */
export function initHybridDetector(enableRoboflow: boolean = true): void {
  const roboflowAvailable = isRoboflowConfigured();

  state = {
    isEnabled: enableRoboflow && roboflowAvailable,
    lastRoboflowResult: null,
    lastFusionOutput: null,
    history: createDetectionHistory(ROBOFLOW_TEMPORAL_WINDOW * 2),
    isProcessing: false,
  };

  if (enableRoboflow && !roboflowAvailable) {
    console.warn('Roboflow requested but not configured. Running in MediaPipe-only mode.');
  }

  console.log(`Hybrid detector initialized. Roboflow: ${state.isEnabled ? 'enabled' : 'disabled'}`);
}

/**
 * Process a video frame through the hybrid detection system
 * @param video HTMLVideoElement to process
 * @param motionMagnitude Current motion magnitude (0-1)
 * @param mediapipeActive Whether MediaPipe is currently detecting
 */
export async function processFrame(
  video: HTMLVideoElement,
  motionMagnitude: number,
  mediapipeActive: boolean
): Promise<HybridDetectionResult> {
  const timestamp = Date.now();

  // Default result with no Roboflow detection
  let result: HybridDetectionResult = {
    roboflowDetections: [],
    fusionOutput: { action: 'rely_gemini', hint: null },
    mediapipeActive,
    timestamp,
  };

  // Skip Roboflow if disabled or already processing
  if (!state.isEnabled || state.isProcessing) {
    return result;
  }

  // Check if we should call the API based on rate limiting and motion
  if (!shouldCallAPI(motionMagnitude)) {
    // Return last result if we have one
    if (state.lastRoboflowResult && state.lastFusionOutput) {
      return {
        roboflowDetections: state.lastRoboflowResult,
        fusionOutput: state.lastFusionOutput,
        mediapipeActive,
        timestamp,
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

    // Fuse detections with history for final output
    const fusionOutput = fuseDetections(bestDetection, state.history);
    state.lastFusionOutput = fusionOutput;

    result = {
      roboflowDetections: detections,
      fusionOutput,
      mediapipeActive,
      timestamp,
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
  state.lastFusionOutput = null;
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
    clearDetectionHistory: typeof clearHistory;
  };

  windowWithDebug.getHybridDetectionState = getHybridDetectorState;
  windowWithDebug.setRoboflowEnabled = setRoboflowEnabled;
  windowWithDebug.clearDetectionHistory = clearHistory;
}
