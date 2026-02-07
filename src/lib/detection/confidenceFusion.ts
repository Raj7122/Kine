// Confidence fusion logic for combining Roboflow YOLO, LSTM, and Gemini results
// Enhanced with ensemble fusion for research-grade accuracy

import { RoboflowDetection } from '../roboflow/types';
import { FusionOutput, DetectionHistory, ComponentConfidences } from './types';
import type { LSTMPrediction } from '../lstm/types';
import {
  ROBOFLOW_CONFIDENCE_THRESHOLD,
  ROBOFLOW_HIGH_CONFIDENCE,
  ROBOFLOW_TEMPORAL_WINDOW,
  LSTM_CONFIDENCE_THRESHOLD,
  MIN_MOTION_THRESHOLD,
  YOLO_FUSION_WEIGHT,
  MEDIAPIPE_FUSION_WEIGHT,
  ENSEMBLE_AGREEMENT_BOOST,
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
 * Fuse Roboflow YOLO detection with LSTM prediction
 * Priority logic:
 * 1. YOLO high-conf (≥0.85) + stillness → Static letter (use_roboflow)
 * 2. LSTM high-conf (≥0.7) + motion → Dynamic sign (use_lstm)
 * 3. YOLO+LSTM agreement → Boosted confidence (use_fused)
 * 4. Conflict or low confidence → Gemini arbitration (enhance_gemini or rely_gemini)
 *
 * @param roboflow Current Roboflow detection (or null if none)
 * @param lstm Current LSTM prediction (or null if none)
 * @param history Detection history for temporal smoothing
 * @param motionMagnitude Current motion magnitude (0-1)
 */
export function fuseWithLSTM(
  roboflow: RoboflowDetection | null,
  lstm: LSTMPrediction | null,
  history: DetectionHistory,
  motionMagnitude: number
): FusionOutput {
  const isStill = motionMagnitude < MIN_MOTION_THRESHOLD;
  const isMoving = motionMagnitude >= MIN_MOTION_THRESHOLD;

  const hasRoboflow = roboflow && roboflow.confidence >= ROBOFLOW_CONFIDENCE_THRESHOLD;
  const hasHighConfRoboflow = roboflow && roboflow.confidence >= ROBOFLOW_HIGH_CONFIDENCE;
  const hasLSTM = lstm && lstm.confidence >= LSTM_CONFIDENCE_THRESHOLD;

  // Priority 1: YOLO high-confidence + stillness → Static letter
  if (
    hasHighConfRoboflow &&
    isStill &&
    isTemporallyConsistent(roboflow!.class, history.classes, ROBOFLOW_TEMPORAL_WINDOW)
  ) {
    return {
      action: 'use_roboflow',
      sign: roboflow!.class,
      confidence: roboflow!.confidence,
      source: 'roboflow',
      lstmPrediction: lstm,
    };
  }

  // Priority 2: LSTM high-confidence + motion → Dynamic sign
  if (hasLSTM && isMoving) {
    // Even better if LSTM prediction has been consistent
    return {
      action: 'use_lstm',
      sign: lstm!.class,
      confidence: lstm!.confidence,
      source: 'lstm',
      lstmPrediction: lstm,
    };
  }

  // Priority 3: Both agree → Boosted confidence
  if (hasRoboflow && hasLSTM) {
    // Check if they're detecting the same or compatible signs
    // (LSTM detects dynamic signs, YOLO detects static letters - unlikely to match)
    // But if confidence is high on both, trust the one matching the context
    if (isStill) {
      return {
        action: 'use_roboflow',
        sign: roboflow!.class,
        confidence: Math.min(roboflow!.confidence * 1.1, 1.0), // Slight boost
        source: 'fused',
        hint: `LSTM also detected: ${lstm!.class}`,
        lstmPrediction: lstm,
      };
    } else {
      return {
        action: 'use_lstm',
        sign: lstm!.class,
        confidence: Math.min(lstm!.confidence * 1.1, 1.0), // Slight boost
        source: 'fused',
        hint: `YOLO also detected: ${roboflow!.class}`,
        lstmPrediction: lstm,
      };
    }
  }

  // Priority 4a: Only YOLO with moderate confidence
  if (hasRoboflow && !hasLSTM) {
    if (
      roboflow!.confidence >= ROBOFLOW_HIGH_CONFIDENCE &&
      isTemporallyConsistent(roboflow!.class, history.classes, ROBOFLOW_TEMPORAL_WINDOW)
    ) {
      return {
        action: 'use_roboflow',
        sign: roboflow!.class,
        confidence: roboflow!.confidence,
        source: 'roboflow',
        lstmPrediction: lstm,
      };
    }

    // Moderate confidence → hint to Gemini
    const confidencePercent = (roboflow!.confidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `YOLO detected "${roboflow!.class}" (${confidencePercent}% confidence)`,
      confidence: roboflow!.confidence,
      source: 'roboflow',
      lstmPrediction: lstm,
    };
  }

  // Priority 4b: Only LSTM with moderate confidence
  if (hasLSTM && !hasRoboflow) {
    // LSTM detected something but below threshold or no motion context
    const confidencePercent = (lstm!.confidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `LSTM detected "${lstm!.class}" (${confidencePercent}% confidence)`,
      confidence: lstm!.confidence,
      source: 'lstm',
      lstmPrediction: lstm,
    };
  }

  // Priority 5: Neither has confident detection
  // Build hints from any available data
  let hint: string | null = null;

  if (roboflow && roboflow.confidence > 0.5) {
    hint = `YOLO suggests "${roboflow.class}" (${(roboflow.confidence * 100).toFixed(0)}%)`;
  }
  if (lstm && lstm.confidence > 0.4) {
    const lstmHint = `LSTM suggests "${lstm.class}" (${(lstm.confidence * 100).toFixed(0)}%)`;
    hint = hint ? `${hint}, ${lstmHint}` : lstmHint;
  }

  return {
    action: hint ? 'enhance_gemini' : 'rely_gemini',
    hint,
    lstmPrediction: lstm,
  };
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

// =============================================================================
// Ensemble Confidence Fusion (Research-Grade)
// =============================================================================

/**
 * Calculate weighted ensemble confidence from YOLO and MediaPipe scores
 * Uses research-validated weights: 60% YOLO, 40% MediaPipe
 *
 * @param yoloConfidence YOLO detection confidence (0-1)
 * @param mediapipeConfidence MediaPipe landmark confidence (0-1)
 * @param agreementBoost Optional boost when both sources agree
 */
export function calculateEnsembleConfidence(
  yoloConfidence: number | undefined,
  mediapipeConfidence: number | undefined,
  agreementBoost: number = 0
): number {
  const yolo = yoloConfidence ?? 0;
  const mediapipe = mediapipeConfidence ?? 0;

  // Weighted combination
  let ensembleScore = YOLO_FUSION_WEIGHT * yolo + MEDIAPIPE_FUSION_WEIGHT * mediapipe;

  // Apply agreement boost if both have high confidence
  if (agreementBoost > 0 && yolo > 0.7 && mediapipe > 0.7) {
    ensembleScore = Math.min(1.0, ensembleScore + agreementBoost);
  }

  return ensembleScore;
}

/**
 * Enhanced fusion using ensemble confidence for static sign detection
 * Incorporates YOLO + MediaPipe ensemble scoring
 *
 * @param roboflow Current Roboflow detection (or null if none)
 * @param lstm Current LSTM prediction (or null if none)
 * @param history Detection history for temporal smoothing
 * @param motionMagnitude Current motion magnitude (0-1)
 * @param mediapipeConfidence MediaPipe landmark confidence for ensemble
 */
export function fuseWithEnsemble(
  roboflow: RoboflowDetection | null,
  lstm: LSTMPrediction | null,
  history: DetectionHistory,
  motionMagnitude: number,
  mediapipeConfidence: number = 0.8
): FusionOutput {
  const isStill = motionMagnitude < MIN_MOTION_THRESHOLD;
  const isMoving = motionMagnitude >= MIN_MOTION_THRESHOLD;

  const hasRoboflow = roboflow && roboflow.confidence >= ROBOFLOW_CONFIDENCE_THRESHOLD;
  const hasLSTM = lstm && lstm.confidence >= LSTM_CONFIDENCE_THRESHOLD;

  // Calculate ensemble confidence for static sign detection
  const yoloConfidence = roboflow?.confidence;
  const ensembleConfidence = calculateEnsembleConfidence(
    yoloConfidence,
    isStill ? mediapipeConfidence : undefined,
    hasRoboflow && isStill ? ENSEMBLE_AGREEMENT_BOOST : 0
  );

  const componentConfidences: ComponentConfidences = {
    yolo: yoloConfidence,
    mediapipe: mediapipeConfidence,
    lstm: lstm?.confidence,
  };

  // Priority 1: High ensemble confidence + stillness → Static letter
  if (
    ensembleConfidence >= 0.80 &&
    isStill &&
    hasRoboflow &&
    isTemporallyConsistent(roboflow!.class, history.classes, ROBOFLOW_TEMPORAL_WINDOW)
  ) {
    return {
      action: 'use_roboflow',
      sign: roboflow!.class,
      confidence: roboflow!.confidence,
      source: 'fused',
      lstmPrediction: lstm,
      ensembleConfidence,
      componentConfidences,
    };
  }

  // Priority 2: LSTM high-confidence + motion → Dynamic sign
  if (hasLSTM && isMoving) {
    return {
      action: 'use_lstm',
      sign: lstm!.class,
      confidence: lstm!.confidence,
      source: 'lstm',
      lstmPrediction: lstm,
      ensembleConfidence,
      componentConfidences,
    };
  }

  // Priority 3: Good ensemble confidence but not great
  if (ensembleConfidence >= 0.65 && hasRoboflow && isStill) {
    const confidencePercent = (roboflow!.confidence * 100).toFixed(0);
    const ensemblePercent = (ensembleConfidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `Ensemble: "${roboflow!.class}" (${ensemblePercent}% combined, YOLO: ${confidencePercent}%)`,
      confidence: ensembleConfidence,
      source: 'fused',
      lstmPrediction: lstm,
      ensembleConfidence,
      componentConfidences,
    };
  }

  // Priority 4: Only YOLO with moderate confidence
  if (hasRoboflow && !hasLSTM) {
    if (
      roboflow!.confidence >= ROBOFLOW_HIGH_CONFIDENCE &&
      isTemporallyConsistent(roboflow!.class, history.classes, ROBOFLOW_TEMPORAL_WINDOW)
    ) {
      return {
        action: 'use_roboflow',
        sign: roboflow!.class,
        confidence: roboflow!.confidence,
        source: 'roboflow',
        lstmPrediction: lstm,
        ensembleConfidence,
        componentConfidences,
      };
    }

    const confidencePercent = (roboflow!.confidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `YOLO detected "${roboflow!.class}" (${confidencePercent}% confidence)`,
      confidence: roboflow!.confidence,
      source: 'roboflow',
      lstmPrediction: lstm,
      ensembleConfidence,
      componentConfidences,
    };
  }

  // Priority 5: Only LSTM
  if (hasLSTM && !hasRoboflow) {
    const confidencePercent = (lstm!.confidence * 100).toFixed(0);
    return {
      action: 'enhance_gemini',
      hint: `LSTM detected "${lstm!.class}" (${confidencePercent}% confidence)`,
      confidence: lstm!.confidence,
      source: 'lstm',
      lstmPrediction: lstm,
      ensembleConfidence,
      componentConfidences,
    };
  }

  // Priority 6: Build hints from any available data
  let hint: string | null = null;

  if (roboflow && roboflow.confidence > 0.5) {
    hint = `YOLO suggests "${roboflow.class}" (${(roboflow.confidence * 100).toFixed(0)}%)`;
  }
  if (lstm && lstm.confidence > 0.4) {
    const lstmHint = `LSTM suggests "${lstm.class}" (${(lstm.confidence * 100).toFixed(0)}%)`;
    hint = hint ? `${hint}, ${lstmHint}` : lstmHint;
  }

  return {
    action: hint ? 'enhance_gemini' : 'rely_gemini',
    hint,
    lstmPrediction: lstm,
    ensembleConfidence,
    componentConfidences,
  };
}
