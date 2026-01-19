// Confidence fusion logic for combining Roboflow YOLO and Gemini results

import { RoboflowDetection } from '../roboflow/types';
import { FusionOutput, DetectionHistory } from './types';
import {
  ROBOFLOW_CONFIDENCE_THRESHOLD,
  ROBOFLOW_HIGH_CONFIDENCE,
  ROBOFLOW_TEMPORAL_WINDOW,
} from '@/config/constants';

/**
 * Check if a detection is temporally consistent with recent history
 * @param currentClass The class detected in current frame
 * @param history Array of recent class detections
 * @param requiredCount Number of consistent frames required
 */
export function isTemporallyConsistent(
  currentClass: string,
  history: string[],
  requiredCount: number = ROBOFLOW_TEMPORAL_WINDOW
): boolean {
  if (history.length < requiredCount - 1) {
    return false;
  }

  // Check if the last (requiredCount - 1) entries match the current class
  const recentHistory = history.slice(-(requiredCount - 1));
  return recentHistory.every((h) => h === currentClass);
}

/**
 * Fuse Roboflow detection with historical context to determine action
 * @param roboflow Current Roboflow detection (or null if none)
 * @param history Detection history for temporal smoothing
 */
export function fuseDetections(
  roboflow: RoboflowDetection | null,
  history: DetectionHistory
): FusionOutput {
  // No detection from Roboflow
  if (!roboflow || roboflow.confidence < ROBOFLOW_CONFIDENCE_THRESHOLD) {
    return { action: 'rely_gemini', hint: null };
  }

  // High confidence + temporal consistency → use Roboflow directly
  if (
    roboflow.confidence >= ROBOFLOW_HIGH_CONFIDENCE &&
    isTemporallyConsistent(roboflow.class, history.classes, ROBOFLOW_TEMPORAL_WINDOW)
  ) {
    return {
      action: 'use_roboflow',
      sign: roboflow.class,
      confidence: roboflow.confidence,
    };
  }

  // Medium confidence → provide hint to Gemini
  if (roboflow.confidence >= ROBOFLOW_CONFIDENCE_THRESHOLD) {
    const confidencePercent = (roboflow.confidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `YOLO detected "${roboflow.class}" (${confidencePercent}% confidence)`,
      confidence: roboflow.confidence,
    };
  }

  // Low confidence → rely on Gemini
  return { action: 'rely_gemini', hint: null };
}

/**
 * Get the best detection from multiple Roboflow predictions
 * @param detections Array of Roboflow detections
 */
export function getBestDetection(
  detections: RoboflowDetection[]
): RoboflowDetection | null {
  if (detections.length === 0) {
    return null;
  }

  // Return detection with highest confidence
  return detections.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );
}

/**
 * Create a new detection history instance
 * @param maxSize Maximum history size to maintain
 */
export function createDetectionHistory(maxSize: number = 10): DetectionHistory {
  return {
    classes: [],
    confidences: [],
    timestamps: [],
    maxSize,
  };
}

/**
 * Add a detection to history, maintaining max size
 * @param history Current history
 * @param detection Detection to add
 */
export function addToHistory(
  history: DetectionHistory,
  detection: RoboflowDetection
): DetectionHistory {
  const newClasses = [...history.classes, detection.class];
  const newConfidences = [...history.confidences, detection.confidence];
  const newTimestamps = [...history.timestamps, detection.timestamp];

  // Trim to max size
  while (newClasses.length > history.maxSize) {
    newClasses.shift();
    newConfidences.shift();
    newTimestamps.shift();
  }

  return {
    classes: newClasses,
    confidences: newConfidences,
    timestamps: newTimestamps,
    maxSize: history.maxSize,
  };
}

/**
 * Calculate average confidence from history
 * @param history Detection history
 * @param windowSize Number of recent entries to average
 */
export function getAverageConfidence(
  history: DetectionHistory,
  windowSize: number = 5
): number {
  if (history.confidences.length === 0) {
    return 0;
  }

  const recent = history.confidences.slice(-windowSize);
  return recent.reduce((sum, c) => sum + c, 0) / recent.length;
}

/**
 * Get the most common class in recent history
 * @param history Detection history
 * @param windowSize Number of recent entries to consider
 */
export function getMostCommonClass(
  history: DetectionHistory,
  windowSize: number = 5
): string | null {
  if (history.classes.length === 0) {
    return null;
  }

  const recent = history.classes.slice(-windowSize);
  const counts = new Map<string, number>();

  for (const cls of recent) {
    counts.set(cls, (counts.get(cls) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommon: string | null = null;

  for (const [cls, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = cls;
    }
  }

  return mostCommon;
}
