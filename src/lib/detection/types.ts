// Hybrid detection system types

import { RoboflowDetection } from '../roboflow/types';
import type { LSTMPrediction } from '../lstm/types';

// Detection source for tracking origin of detections
export type DetectionSource = 'roboflow' | 'lstm' | 'gemini' | 'fused';

// Detection mode for the hybrid system
export type DetectionMode = 'STATIC' | 'DYNAMIC' | 'HYBRID';

export type FusionAction =
  | 'use_roboflow'     // High-confidence static letter from YOLO
  | 'use_lstm'         // High-confidence dynamic sign from LSTM
  | 'use_fused'        // Combined YOLO + LSTM agreement
  | 'enhance_gemini'   // Pass hints to Gemini for arbitration
  | 'rely_gemini';     // No confident detection, use Gemini

export interface ComponentConfidences {
  yolo?: number;
  mediapipe?: number;
  lstm?: number;
  gemini?: number;
}

export interface FusionOutput {
  action: FusionAction;
  sign?: string;           // Detected sign/letter
  hint?: string | null;    // For 'enhance_gemini' action
  confidence?: number;
  source?: DetectionSource;
  lstmPrediction?: LSTMPrediction | null;  // Include LSTM result for context
  ensembleConfidence?: number;             // Combined ensemble confidence score
  componentConfidences?: ComponentConfidences; // Individual source confidences
}

export interface HybridDetectionResult {
  roboflowDetections: RoboflowDetection[];
  lstmPrediction: LSTMPrediction | null;
  fusionOutput: FusionOutput;
  mediapipeActive: boolean;
  timestamp: number;
  detectionMode: DetectionMode;
}

export interface DetectionHistory {
  classes: string[];
  confidences: number[];
  timestamps: number[];
  maxSize: number;
}

export interface HybridDetectorState {
  isEnabled: boolean;
  lastRoboflowResult: RoboflowDetection[] | null;
  lastLSTMPrediction: LSTMPrediction | null;
  lastFusionOutput: FusionOutput | null;
  history: DetectionHistory;
  isProcessing: boolean;
  detectionMode: DetectionMode;
  isLSTMEnabled: boolean;
}

export interface HybridDetectorConfig {
  enableRoboflow: boolean;
  enableLSTM: boolean;
  confidenceThreshold: number;
  highConfidenceThreshold: number;
  temporalWindow: number;
  detectionMode: DetectionMode;
}
