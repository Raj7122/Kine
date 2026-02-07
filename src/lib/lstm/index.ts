// LSTM Dynamic Gesture Recognition Module
// Barrel exports for the LSTM subsystem

// Types
export type {
  LandmarkFrame,
  NormalizedFrame,
  LSTMPrediction,
  TemporalDetectorState,
  LSTMConfig,
  TemporalBufferState,
  BufferProcessResult,
  LSTMModelMetadata,
} from './types';

// Temporal Buffer
export {
  TemporalBuffer,
  windowToTensorInput,
} from './temporalBuffer';

// LSTM Service
export {
  loadModel,
  predictSign,
  isConfidentPrediction,
  getModelMetadata,
  getLSTMServiceState,
  disposeModel,
  isModelReady,
} from './lstmService';
