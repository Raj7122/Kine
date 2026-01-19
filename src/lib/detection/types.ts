// Hybrid detection system types

import { RoboflowDetection } from '../roboflow/types';

export type FusionAction = 'use_roboflow' | 'enhance_gemini' | 'rely_gemini';

export interface FusionOutput {
  action: FusionAction;
  sign?: string;           // For 'use_roboflow' action
  hint?: string | null;    // For 'enhance_gemini' action
  confidence?: number;
}

export interface HybridDetectionResult {
  roboflowDetections: RoboflowDetection[];
  fusionOutput: FusionOutput;
  mediapipeActive: boolean;
  timestamp: number;
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
  lastFusionOutput: FusionOutput | null;
  history: DetectionHistory;
  isProcessing: boolean;
}

export interface HybridDetectorConfig {
  enableRoboflow: boolean;
  confidenceThreshold: number;
  highConfidenceThreshold: number;
  temporalWindow: number;
}
