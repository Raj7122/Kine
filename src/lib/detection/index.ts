// Hybrid detection system
// Combines Roboflow YOLO API with MediaPipe + LSTM for improved ASL recognition

export * from './types';
export * from './confidenceFusion';
export {
  initHybridDetector,
  processFrame,
  getHybridDetectorState,
  setRoboflowEnabled,
  setLSTMEnabled,
  setDetectionMode,
  clearHistory,
  getLastFusionOutput,
  getLastLSTMPrediction,
  getCurrentDetections,
  getDetectionHistory,
  updateLSTMPrediction,
} from './hybridDetector';
