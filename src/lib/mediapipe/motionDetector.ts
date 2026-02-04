import type { Landmark, HandLandmarkResult } from './types';
import {
  MIN_MOTION_THRESHOLD,
  CONSECUTIVE_FRAME_REQUIREMENT,
  Z_AXIS_SMOOTHING,
  LANDMARK_SMOOTHING_FACTOR,
  MAX_ACCELERATION,
  HAND_SEPARATION_DISTANCE,
  OCCLUSION_TOLERANCE_FRAMES,
} from '@/config/constants';

/**
 * Landmark smoother using exponential smoothing for fluid motion
 */
class LandmarkSmoother {
  private smoothedLandmarks: Map<string, Landmark> = new Map();
  private smoothingFactor: number;

  constructor(smoothingFactor: number = LANDMARK_SMOOTHING_FACTOR) {
    this.smoothingFactor = smoothingFactor;
  }

  /**
   * Apply exponential smoothing to landmarks
   * smoothed = alpha * current + (1 - alpha) * previous
   */
  smooth(landmarks: Landmark[][], handIndex: number): Landmark[][] {
    return landmarks.map((hand, hIdx) => {
      return hand.map((landmark, lIdx) => {
        const key = `${handIndex}_${hIdx}_${lIdx}`;
        const previous = this.smoothedLandmarks.get(key);

        if (!previous) {
          this.smoothedLandmarks.set(key, { ...landmark });
          return landmark;
        }

        const smoothed: Landmark = {
          x: this.smoothingFactor * landmark.x + (1 - this.smoothingFactor) * previous.x,
          y: this.smoothingFactor * landmark.y + (1 - this.smoothingFactor) * previous.y,
          z: this.smoothingFactor * (landmark.z ?? 0) + (1 - this.smoothingFactor) * (previous.z ?? 0),
        };

        this.smoothedLandmarks.set(key, smoothed);
        return smoothed;
      });
    });
  }

  reset(): void {
    this.smoothedLandmarks.clear();
  }
}

/**
 * Motion detector for tracking hand movement over time
 * Enhanced with smoothing, acceleration filtering, hand separation, and occlusion tolerance
 */
export class MotionDetector {
  private previousLandmarks: Landmark[][] | null = null;
  private previousVelocities: Map<string, number> = new Map();
  private motionHistory: number[] = [];
  private historySize: number;
  private smoother: LandmarkSmoother;
  private framesWithoutHands: number = 0;
  private lastValidLandmarks: Landmark[][] | null = null;

  constructor(historySize: number = 5) {
    this.historySize = historySize;
    this.smoother = new LandmarkSmoother(LANDMARK_SMOOTHING_FACTOR);
  }

  /**
   * Update with new hand landmarks and return motion magnitude
   */
  update(handResult: HandLandmarkResult | null): number {
    if (!handResult || handResult.landmarks.length === 0) {
      // Handle occlusion tolerance - maintain tracking for a few frames
      this.framesWithoutHands++;

      if (this.framesWithoutHands <= OCCLUSION_TOLERANCE_FRAMES && this.lastValidLandmarks) {
        // Use last valid landmarks during brief occlusions
        return this.getAverageMotion();
      }

      // No hands detected for too long - reset
      this.reset();
      return 0;
    }

    // Reset occlusion counter when hands are detected
    this.framesWithoutHands = 0;

    // Check hand separation if two hands detected
    let currentLandmarks = handResult.landmarks;
    if (currentLandmarks.length >= 2) {
      currentLandmarks = this.filterMergedHands(currentLandmarks);
    }

    // Apply smoothing to landmarks
    currentLandmarks = this.smoother.smooth(currentLandmarks, 0);
    this.lastValidLandmarks = currentLandmarks;

    if (!this.previousLandmarks) {
      // First frame - store and return 0
      this.previousLandmarks = currentLandmarks;
      return 0;
    }

    // Calculate motion magnitude with acceleration filtering
    const motion = this.calculateMotionWithAccelerationFilter(
      currentLandmarks,
      this.previousLandmarks
    );

    // Update history
    this.motionHistory.push(motion);
    if (this.motionHistory.length > this.historySize) {
      this.motionHistory.shift();
    }

    // Store current as previous
    this.previousLandmarks = currentLandmarks;

    return motion;
  }

  /**
   * Filter out potentially merged hands based on separation distance
   */
  private filterMergedHands(landmarks: Landmark[][]): Landmark[][] {
    if (landmarks.length < 2) return landmarks;

    // Calculate distance between hand centroids
    const getCentroid = (hand: Landmark[]): { x: number; y: number } => {
      const sum = hand.reduce(
        (acc, l) => ({ x: acc.x + l.x, y: acc.y + l.y }),
        { x: 0, y: 0 }
      );
      return { x: sum.x / hand.length, y: sum.y / hand.length };
    };

    const centroid1 = getCentroid(landmarks[0]);
    const centroid2 = getCentroid(landmarks[1]);

    const distance = Math.sqrt(
      Math.pow(centroid1.x - centroid2.x, 2) +
      Math.pow(centroid1.y - centroid2.y, 2)
    );

    // If hands are too close, they might be falsely merged - keep only the first
    if (distance < HAND_SEPARATION_DISTANCE) {
      console.debug(`Hands too close (${distance.toFixed(3)}), filtering potential merge`);
      return [landmarks[0]];
    }

    return landmarks;
  }

  /**
   * Calculate motion with acceleration-based artifact filtering
   */
  private calculateMotionWithAccelerationFilter(
    current: Landmark[][],
    previous: Landmark[][]
  ): number {
    let totalMotion = 0;
    let pointCount = 0;
    let filteredPoints = 0;

    const handsToCompare = Math.min(current.length, previous.length);

    for (let h = 0; h < handsToCompare; h++) {
      const currentHand = current[h];
      const previousHand = previous[h];
      const landmarksToCompare = Math.min(currentHand.length, previousHand.length);

      for (let i = 0; i < landmarksToCompare; i++) {
        const curr = currentHand[i];
        const prev = previousHand[i];
        const key = `${h}_${i}`;

        // Calculate velocity (distance per frame)
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const dz = (curr.z ?? 0) - (prev.z ?? 0);

        // Use Z_AXIS_SMOOTHING for depth weight
        const distance = Math.sqrt(dx * dx + dy * dy + (dz * dz * Z_AXIS_SMOOTHING));

        // Calculate acceleration (change in velocity)
        const previousVelocity = this.previousVelocities.get(key) ?? 0;
        const acceleration = Math.abs(distance - previousVelocity);

        // Store current velocity for next frame
        this.previousVelocities.set(key, distance);

        // Filter out points with unrealistic acceleration (likely tracking errors)
        if (acceleration > MAX_ACCELERATION) {
          filteredPoints++;
          continue;
        }

        totalMotion += distance;
        pointCount++;
      }
    }

    if (filteredPoints > 0) {
      console.debug(`Filtered ${filteredPoints} points due to excessive acceleration`);
    }

    return pointCount > 0 ? totalMotion / pointCount : 0;
  }

  /**
   * Get average motion over recent history
   */
  getAverageMotion(): number {
    if (this.motionHistory.length === 0) return 0;

    const sum = this.motionHistory.reduce((a, b) => a + b, 0);
    return sum / this.motionHistory.length;
  }

  /**
   * Check if motion is below threshold (user stopped moving)
   * Requires consecutive frames to confirm stillness
   */
  isStill(): boolean {
    if (this.motionHistory.length < CONSECUTIVE_FRAME_REQUIREMENT) {
      return false;
    }

    return this.getAverageMotion() < MIN_MOTION_THRESHOLD;
  }

  /**
   * Check if there's significant motion (user is signing)
   */
  isMoving(): boolean {
    return this.getAverageMotion() >= MIN_MOTION_THRESHOLD;
  }

  /**
   * Reset the detector
   */
  reset(): void {
    this.previousLandmarks = null;
    this.previousVelocities.clear();
    this.motionHistory = [];
    this.smoother.reset();
    this.framesWithoutHands = 0;
    this.lastValidLandmarks = null;
  }

  /**
   * Get current motion threshold
   */
  getThreshold(): number {
    return MIN_MOTION_THRESHOLD;
  }

  /**
   * Get frames without hand detection (for debugging)
   */
  getOcclusionFrames(): number {
    return this.framesWithoutHands;
  }
}

// Singleton instance for convenience
let defaultDetector: MotionDetector | null = null;

export function getMotionDetector(): MotionDetector {
  if (!defaultDetector) {
    defaultDetector = new MotionDetector();
  }
  return defaultDetector;
}

export function resetMotionDetector(): void {
  if (defaultDetector) {
    defaultDetector.reset();
  }
}
