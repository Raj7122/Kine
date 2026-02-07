// Temporal Buffer for LSTM Dynamic Gesture Recognition
// Implements sliding window buffer with stride-based inference triggering

import type { Landmark, HandLandmarkResult } from '@/lib/mediapipe/types';
import type {
  LandmarkFrame,
  NormalizedFrame,
  TemporalBufferState,
  BufferProcessResult,
} from './types';
import {
  LSTM_WINDOW_SIZE,
  LSTM_STRIDE,
  LSTM_MIN_MOTION_FRAMES,
  LSTM_FEATURE_COUNT,
  MIN_MOTION_THRESHOLD,
} from '@/config/constants';

// Type for dominant hand preference
export type DominantHand = 'left' | 'right' | 'auto';

// Module-level dominant hand tracking
let detectedDominantHand: DominantHand = 'auto';
let handUsageCount = { left: 0, right: 0 };

/**
 * Flatten hand landmarks into a 1D array of features
 * Research-grade: Focus on single dominant hand (63 features) for better accuracy
 *
 * @param handResult MediaPipe hand detection result
 * @param hasLeft Whether left hand is detected
 * @param hasRight Whether right hand is detected
 * @param dominantHand Preferred dominant hand ('left', 'right', or 'auto' for detection)
 */
function flattenLandmarks(
  handResult: HandLandmarkResult | null,
  hasLeft: boolean,
  hasRight: boolean,
  dominantHand: DominantHand = 'auto'
): number[] {
  const features = new Array<number>(LSTM_FEATURE_COUNT).fill(0);

  if (!handResult || handResult.landmarks.length === 0) {
    return features;
  }

  // Determine which hand is which based on handedness
  let leftHandLandmarks: Landmark[] | null = null;
  let rightHandLandmarks: Landmark[] | null = null;

  for (let i = 0; i < handResult.landmarks.length; i++) {
    const handedness = handResult.handedness[i]?.[0]?.categoryName;
    if (handedness === 'Left') {
      leftHandLandmarks = handResult.landmarks[i];
    } else if (handedness === 'Right') {
      rightHandLandmarks = handResult.landmarks[i];
    }
  }

  // Track hand usage for auto-detection
  if (dominantHand === 'auto') {
    if (leftHandLandmarks) handUsageCount.left++;
    if (rightHandLandmarks) handUsageCount.right++;

    // After 30 frames, determine dominant hand
    const totalFrames = handUsageCount.left + handUsageCount.right;
    if (totalFrames >= 30 && detectedDominantHand === 'auto') {
      detectedDominantHand = handUsageCount.right >= handUsageCount.left ? 'right' : 'left';
      console.log(`[TemporalBuffer] Detected dominant hand: ${detectedDominantHand}`);
    }
  }

  if (features.length >= 126) {
    if (leftHandLandmarks) {
      for (let i = 0; i < Math.min(21, leftHandLandmarks.length); i++) {
        const landmark = leftHandLandmarks[i];
        features[i * 3] = landmark.x;
        features[i * 3 + 1] = landmark.y;
        features[i * 3 + 2] = landmark.z ?? 0;
      }
    }

    if (rightHandLandmarks) {
      for (let i = 0; i < Math.min(21, rightHandLandmarks.length); i++) {
        const landmark = rightHandLandmarks[i];
        const base = 63 + i * 3;
        features[base] = landmark.x;
        features[base + 1] = landmark.y;
        features[base + 2] = landmark.z ?? 0;
      }
    }

    return features;
  }

  // Select the hand to use
  let selectedHand: Landmark[] | null = null;

  const effectiveDominant = dominantHand === 'auto' ? detectedDominantHand : dominantHand;

  if (effectiveDominant === 'left' && leftHandLandmarks) {
    selectedHand = leftHandLandmarks;
  } else if (effectiveDominant === 'right' && rightHandLandmarks) {
    selectedHand = rightHandLandmarks;
  } else if (effectiveDominant === 'auto') {
    // Auto mode before detection: prefer right hand (more common)
    selectedHand = rightHandLandmarks || leftHandLandmarks;
  } else {
    // Fallback: use whichever hand is available
    selectedHand = rightHandLandmarks || leftHandLandmarks;
  }

  // Fill features array with single hand (63 features: 21 landmarks × 3 coords)
  if (selectedHand) {
    for (let i = 0; i < Math.min(21, selectedHand.length); i++) {
      const landmark = selectedHand[i];
      features[i * 3] = landmark.x;
      features[i * 3 + 1] = landmark.y;
      features[i * 3 + 2] = landmark.z ?? 0;
    }
  }

  return features;
}

/**
 * Reset dominant hand detection (useful when user changes)
 */
export function resetDominantHandDetection(): void {
  detectedDominantHand = 'auto';
  handUsageCount = { left: 0, right: 0 };
}

/**
 * Get the currently detected dominant hand
 */
export function getDetectedDominantHand(): DominantHand {
  return detectedDominantHand;
}

/**
 * Manually set the dominant hand preference
 */
export function setDominantHand(hand: DominantHand): void {
  detectedDominantHand = hand;
}

/**
 * Normalize landmarks to be wrist-centered and unit-scaled
 * This makes the model invariant to hand position and size
 * Research-grade: Single hand focus (63 features)
 */
function normalizeLandmarks(features: number[]): number[] {
  const normalized = [...features];

  // Process single dominant hand (indices 0-62, 21 landmarks × 3 coords)
  normalizeHand(normalized, 0, 63);

  if (normalized.length >= 126) {
    normalizeHand(normalized, 63, 126);
  }

  return normalized;
}

/**
 * Normalize a single hand's landmarks
 */
function normalizeHand(features: number[], start: number, end: number): void {
  // Check if hand has data (wrist position is non-zero)
  const wristX = features[start];
  const wristY = features[start + 1];
  const wristZ = features[start + 2];

  if (wristX === 0 && wristY === 0 && wristZ === 0) {
    return; // No hand data
  }

  // Center landmarks around wrist
  for (let i = start; i < end; i += 3) {
    features[i] -= wristX;
    features[i + 1] -= wristY;
    features[i + 2] -= wristZ;
  }

  // Calculate bounding box for scaling
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = start; i < end; i += 3) {
    minX = Math.min(minX, features[i]);
    maxX = Math.max(maxX, features[i]);
    minY = Math.min(minY, features[i + 1]);
    maxY = Math.max(maxY, features[i + 1]);
  }

  // Scale to unit bounding box
  const scaleX = maxX - minX;
  const scaleY = maxY - minY;
  const scale = Math.max(scaleX, scaleY, 0.001); // Prevent division by zero

  for (let i = start; i < end; i += 3) {
    features[i] /= scale;
    features[i + 1] /= scale;
    // Z-axis gets same scale for consistency
    features[i + 2] /= scale;
  }
}

/**
 * Calculate motion magnitude between two frames
 */
function calculateMotionMagnitude(
  current: number[],
  previous: number[] | null
): number {
  if (!previous) return 0;

  let totalMotion = 0;
  let pointCount = 0;

  for (let i = 0; i < current.length; i += 3) {
    // Skip if both current and previous are zero (no hand)
    if (current[i] === 0 && current[i + 1] === 0 &&
        previous[i] === 0 && previous[i + 1] === 0) {
      continue;
    }

    const dx = current[i] - previous[i];
    const dy = current[i + 1] - previous[i + 1];
    const motion = Math.sqrt(dx * dx + dy * dy);

    totalMotion += motion;
    pointCount++;
  }

  return pointCount > 0 ? totalMotion / pointCount : 0;
}

/**
 * Temporal Buffer class for managing the sliding window
 */
export class TemporalBuffer {
  private frames: LandmarkFrame[] = [];
  private framesSinceLastInference = 0;
  private previousLandmarks: number[] | null = null;
  private config: {
    windowSize: number;
    stride: number;
    minMotionFrames: number;
  };

  constructor(config?: Partial<typeof TemporalBuffer.prototype.config>) {
    this.config = {
      windowSize: config?.windowSize ?? LSTM_WINDOW_SIZE,
      stride: config?.stride ?? LSTM_STRIDE,
      minMotionFrames: config?.minMotionFrames ?? LSTM_MIN_MOTION_FRAMES,
    };
  }

  /**
   * Add a new frame from MediaPipe hand detection
   */
  addFrame(handResult: HandLandmarkResult | null): BufferProcessResult {
    // Determine hand presence
    let hasLeft = false;
    let hasRight = false;

    if (handResult && handResult.handedness) {
      for (const h of handResult.handedness) {
        const name = h[0]?.categoryName;
        if (name === 'Left') hasLeft = true;
        if (name === 'Right') hasRight = true;
      }
    }

    // Flatten landmarks
    const landmarks = flattenLandmarks(handResult, hasLeft, hasRight);

    // Calculate motion
    const motionMagnitude = calculateMotionMagnitude(landmarks, this.previousLandmarks);
    this.previousLandmarks = landmarks;

    // Create frame object
    const frame: LandmarkFrame = {
      timestamp: Date.now(),
      landmarks,
      hasLeftHand: hasLeft,
      hasRightHand: hasRight,
      motionMagnitude,
    };

    // Add to buffer
    this.frames.push(frame);
    this.framesSinceLastInference++;

    // Maintain window size
    if (this.frames.length > this.config.windowSize) {
      this.frames.shift();
    }

    // Check if we should run inference
    return this.checkInferenceConditions();
  }

  /**
   * Check if conditions are met for LSTM inference
   */
  private checkInferenceConditions(): BufferProcessResult {
    // Not enough frames yet
    if (this.frames.length < this.config.windowSize) {
      return {
        shouldInfer: false,
        window: null,
        reason: 'not_ready',
      };
    }

    // Check if stride reached
    if (this.framesSinceLastInference < this.config.stride) {
      return {
        shouldInfer: false,
        window: null,
        reason: 'not_ready',
      };
    }

    // Count frames with significant motion
    const motionFrames = this.frames.filter(
      f => f.motionMagnitude > MIN_MOTION_THRESHOLD
    ).length;

    if (motionFrames < this.config.minMotionFrames) {
      // Not enough motion - don't waste inference
      return {
        shouldInfer: false,
        window: null,
        reason: 'insufficient_motion',
      };
    }

    // Reset stride counter
    this.framesSinceLastInference = 0;

    return {
      shouldInfer: true,
      window: [...this.frames],
      reason: 'stride_reached',
    };
  }

  /**
   * Get the current window ready for LSTM input
   * Returns normalized frames as a 2D array [windowSize, featureCount]
   */
  getWindowForInference(): NormalizedFrame[] | null {
    if (this.frames.length < this.config.windowSize) {
      return null;
    }

    return this.frames.map(frame => ({
      features: normalizeLandmarks(frame.landmarks),
      hasMotion: frame.motionMagnitude > MIN_MOTION_THRESHOLD,
    }));
  }

  /**
   * Get the raw window timestamps for prediction metadata
   */
  getWindowTimestamps(): { start: number; end: number } | null {
    if (this.frames.length < this.config.windowSize) {
      return null;
    }

    return {
      start: this.frames[0].timestamp,
      end: this.frames[this.frames.length - 1].timestamp,
    };
  }

  /**
   * Get current buffer state
   */
  getState(): TemporalBufferState {
    const motionFrames = this.frames.filter(
      f => f.motionMagnitude > MIN_MOTION_THRESHOLD
    ).length;

    return {
      frames: [...this.frames],
      framesSinceLastInference: this.framesSinceLastInference,
      isBufferFull: this.frames.length >= this.config.windowSize,
      motionFramesInWindow: motionFrames,
    };
  }

  /**
   * Clear the buffer (e.g., when hands leave frame for extended period)
   */
  clear(): void {
    this.frames = [];
    this.framesSinceLastInference = 0;
    this.previousLandmarks = null;
  }

  /**
   * Reset stride counter without clearing buffer
   * Useful when we want to force inference on next stride
   */
  resetStride(): void {
    this.framesSinceLastInference = 0;
  }

  /**
   * Get the number of frames currently in buffer
   */
  get length(): number {
    return this.frames.length;
  }

  /**
   * Check if buffer has enough motion for inference
   */
  hasEnoughMotion(): boolean {
    const motionFrames = this.frames.filter(
      f => f.motionMagnitude > MIN_MOTION_THRESHOLD
    ).length;
    return motionFrames >= this.config.minMotionFrames;
  }
}

/**
 * Convert a window of normalized frames to a tensor-ready format
 * Output shape: [1, windowSize, featureCount] for batch inference
 */
export function windowToTensorInput(
  normalizedFrames: NormalizedFrame[],
  windowSize: number = LSTM_WINDOW_SIZE,
  featureCount: number = LSTM_FEATURE_COUNT
): number[][][] {
  // Ensure we have exactly windowSize frames
  const frames = normalizedFrames.slice(-windowSize);

  // Pad with zeros if needed
  while (frames.length < windowSize) {
    frames.unshift({
      features: new Array(featureCount).fill(0),
      hasMotion: false,
    });
  }

  // Return in batch format [1, windowSize, featureCount]
  return [frames.map(f => f.features)];
}
