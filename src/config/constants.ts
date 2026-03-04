// Configuration constants for Kine app

// =============================================================================
// Detection Parameters (tuned for optimal ASL recognition)
// =============================================================================

// Frame rate and sampling
export const TARGET_FPS = 30; // Minimum frame rate for natural motion capture
export const LANDMARK_SAMPLING_RATE = 33; // ms between inference runs (30 FPS)

// Landmark smoothing
export const LANDMARK_SMOOTHING_FACTOR = 0.85; // Exponential smoothing for fluid motion

// MediaPipe confidence thresholds
export const MEDIAPIPE_LANDMARK_CONFIDENCE = 0.65; // Balanced confidence for better detection rate
export const MEDIAPIPE_DETECTION_CONFIDENCE = 0.5; // Lower threshold to catch hands more reliably
export const MEDIAPIPE_TRACKING_CONFIDENCE = 0.6; // Moderate tracking to maintain lock once found

// Motion detection
export const MIN_MOTION_THRESHOLD = 0.023; // ~15px / 640px normalized - captures subtle movements
export const CONSECUTIVE_FRAME_REQUIREMENT = 4; // ~130ms natural latency at 30fps
export const Z_AXIS_SMOOTHING = 0.80; // Smooth depth tracking
export const MAX_ACCELERATION = 0.25; // ~160px / 640px normalized - allows quick finger motions (J, Z) while catching artifacts

// Hand tracking
export const HAND_SEPARATION_DISTANCE = 0.031; // ~20px / 640px normalized - prevents false merging
export const OCCLUSION_TOLERANCE_FRAMES = 3; // Continuous tracking through brief occlusions

// =============================================================================
// Depth Tracking (z-axis velocity smoothing)
// =============================================================================
export const HAND_SIZE_VARIANCE_THRESHOLD = 0.15; // Maximum acceptable hand size variance
export const MAX_Z_VELOCITY = 2.0; // Maximum z-axis velocity (normalized units/frame)
export const VELOCITY_SMOOTHING = 0.80; // Exponential smoothing for velocity calculations

// =============================================================================
// Roboflow YOLO Configuration
// =============================================================================

export const ROBOFLOW_API_URL = 'https://detect.roboflow.com';
export const ROBOFLOW_CONFIDENCE_THRESHOLD = 0.78; // Balanced detection
export const ROBOFLOW_HIGH_CONFIDENCE = 0.85; // High confidence threshold
export const ROBOFLOW_TEMPORAL_WINDOW = 3; // Frames for temporal smoothing
export const ROBOFLOW_INFERENCE_INTERVAL = 33; // Match 30fps
export const ROBOFLOW_MAX_CONCURRENT = 2; // Max concurrent API requests
export const ROBOFLOW_IMAGE_SIZE = 640; // Input image size
export const ROBOFLOW_HIGH_ACCURACY_SIZE = 1280; // High-accuracy mode input size

// =============================================================================
// Translation Settings
// =============================================================================

export const SILENCE_TRIGGER_THRESHOLD = 800; // ms of no motion to trigger translation
export const SIGNING_RESULT_MIN_DISPLAY_MS = 500; // ms minimum result display before accepting new input
export const MAX_BUFFER_SIZE = 60; // max frames to buffer (~2s at 30 FPS; reduced from 120 to cut Gemini payload)
export const MIN_PHRASE_FRAMES = 25; // minimum frames needed to consider a phrase (vs single sign)

// Sign recognition settings
export const SIGN_RECOGNITION_FRAME_COUNT = 8; // video frames for Gemini (8 needed for motion-direction signs like THANK YOU vs HELLO; 320×240 JPEG q=0.5)
export const SIGN_RECOGNITION_MAX_LANDMARKS = 30; // max landmark frames to send (reduced from 60 — 60+ frames caused Gemini timeouts >15s)

// =============================================================================
// Avatar & UI
// =============================================================================

// Avatar fallback
export const AVATAR_FALLBACK_URL = "/assets/video/fallback.mp4";

// UI constants
export const MODE_TOGGLE_SIZE = "h-20 w-20"; // Thumb zone button size
export const TRANSITION_DURATION = 0.3; // seconds for view transitions

// =============================================================================
// LSTM Dynamic Gesture Recognition (Research-Grade CNN-LSTM Architecture)
// =============================================================================

// LSTM_ENABLED: Master kill-switch for the LSTM pipeline.
// Set to false because the current model is confidently wrong (predicts DRINK/FOOD
// at 98%+ for every sign). When false: no model download (~97MB saved), no TF.js
// import, no inference, no dynamic-mode influence. All LSTM code stays intact —
// set back to true after retraining the model with a cleaned dataset.
export const LSTM_ENABLED = false;

export const LSTM_WINDOW_SIZE = 16;           // frames (~530ms at 30fps - research optimal)
export const LSTM_STRIDE = 8;                 // 50% overlap for dense inference
export const LSTM_MIN_MOTION_FRAMES = 4;      // reduced for smaller window
export const LSTM_CONFIDENCE_THRESHOLD = 0.8; // prediction threshold for hint to Gemini (raised from 0.7 — model overfits)
export const LSTM_SHORTCIRCUIT_THRESHOLD = 2.0; // DISABLED — model is confidently wrong (DRINK/FOOD 98%+ for HELLO). Restore to 0.95 after retraining.
export const LSTM_MODEL_PATH = '/models/asl_cnn_lstm_25.json';
export const LSTM_FEATURE_COUNT = 63;         // 21 landmarks × 3 coords × 1 dominant hand

// CNN-LSTM Architecture Constants
export const CNN_FILTERS = 128;               // Conv1D filters
export const CNN_KERNEL_SIZE = 3;             // Conv1D kernel size
export const LSTM_UNITS_FORWARD = 128;        // Bidirectional LSTM units (forward)
export const LSTM_UNITS_BACKWARD = 128;       // Bidirectional LSTM units (backward)
export const DENSE_HIDDEN_UNITS = [128, 64] as const; // Dense layer sizes
export const DROPOUT_CNN = 0.3;               // CNN dropout rate
export const DROPOUT_DENSE_1 = 0.5;           // First dense dropout
export const DROPOUT_DENSE_2 = 0.3;           // Second dense dropout

// =============================================================================
// Ensemble Fusion Weights
// =============================================================================
export const YOLO_FUSION_WEIGHT = 0.60;       // YOLO contribution to ensemble
export const MEDIAPIPE_FUSION_WEIGHT = 0.40;  // MediaPipe contribution to ensemble
export const ENSEMBLE_AGREEMENT_BOOST = 0.15; // Confidence boost when sources agree

// Dynamic mode detection thresholds
// When LSTM buffer has accumulated motion frames, use extended stillness threshold
// to allow dynamic signs to complete before triggering translation
export const DYNAMIC_MODE_STILLNESS_THRESHOLD = 1000; // ms - extended stillness for dynamic signs (faster)
export const DYNAMIC_MODE_BUFFER_THRESHOLD = 8;       // frames - minimum motion frames to trigger dynamic mode

// LSTM target vocabulary (29 signs: 19 Kaggle + 10 WLASL)
export const LSTM_VOCABULARY = [
  // Existing 11-sign model order (kept first for backward compatibility)
  'HELLO', 'PLEASE', 'THANK_YOU', 'LIKE', 'WHERE',
  'WHO', 'WHY', 'YES', 'NO', 'BAD', 'FINISH',
  // Kaggle expansion
  'GOODBYE', 'GOOD', 'NEED', 'CLEAN', 'FOOD',
  'DRINK', 'WATER', 'BATHROOM',
  // WLASL expansion
  'SORRY', 'HELP', 'UNDERSTAND', 'WANT', 'NAME',
  'WHAT', 'WHEN', 'HOW', 'MEET', 'AGAIN',
] as const;

export type LSTMSignClass = typeof LSTM_VOCABULARY[number];
