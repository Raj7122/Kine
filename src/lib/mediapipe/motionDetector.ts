import type { Landmark, HandLandmarkResult } from './types';

// Motion threshold - lower value = more sensitive
const MOTION_THRESHOLD = 0.015;

// Minimum frames needed to calculate motion
const MIN_FRAMES_FOR_MOTION = 2;

/**
 * Motion detector for tracking hand movement over time
 */
export class MotionDetector {
  private previousLandmarks: Landmark[][] | null = null;
  private motionHistory: number[] = [];
  private historySize: number;

  constructor(historySize: number = 5) {
    this.historySize = historySize;
  }

  /**
   * Update with new hand landmarks and return motion magnitude
   */
  update(handResult: HandLandmarkResult | null): number {
    if (!handResult || handResult.landmarks.length === 0) {
      // No hands detected - reset and return 0
      this.reset();
      return 0;
    }

    const currentLandmarks = handResult.landmarks;

    if (!this.previousLandmarks) {
      // First frame - store and return 0
      this.previousLandmarks = currentLandmarks;
      return 0;
    }

    // Calculate motion magnitude
    const motion = this.calculateMotion(currentLandmarks, this.previousLandmarks);

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
   * Calculate motion between two sets of landmarks
   */
  private calculateMotion(current: Landmark[][], previous: Landmark[][]): number {
    let totalMotion = 0;
    let pointCount = 0;

    // Compare each hand
    const handsToCompare = Math.min(current.length, previous.length);

    for (let h = 0; h < handsToCompare; h++) {
      const currentHand = current[h];
      const previousHand = previous[h];

      // Compare each landmark
      const landmarksToCompare = Math.min(currentHand.length, previousHand.length);

      for (let i = 0; i < landmarksToCompare; i++) {
        const curr = currentHand[i];
        const prev = previousHand[i];

        // Euclidean distance in 2D (x, y only, z is less reliable)
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        totalMotion += distance;
        pointCount++;
      }
    }

    // Return average motion per point
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
   */
  isStill(): boolean {
    if (this.motionHistory.length < MIN_FRAMES_FOR_MOTION) {
      return false;
    }

    return this.getAverageMotion() < MOTION_THRESHOLD;
  }

  /**
   * Check if there's significant motion (user is signing)
   */
  isMoving(): boolean {
    return this.getAverageMotion() >= MOTION_THRESHOLD;
  }

  /**
   * Reset the detector
   */
  reset(): void {
    this.previousLandmarks = null;
    this.motionHistory = [];
  }

  /**
   * Get current motion threshold
   */
  getThreshold(): number {
    return MOTION_THRESHOLD;
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
