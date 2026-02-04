// Configuration constants for Kine app
// Phase 1-4: USE_MOCK_DATA = true
// Phase 5: Set to false for real backend

export const USE_MOCK_DATA = false;

// =============================================================================
// Detection Parameters (tuned for optimal ASL recognition)
// =============================================================================

// Frame rate and sampling
export const TARGET_FPS = 30; // Minimum frame rate for natural motion capture
export const LANDMARK_SAMPLING_RATE = 33; // ms between inference runs (30 FPS)

// Landmark smoothing
export const LANDMARK_SMOOTHING_FACTOR = 0.85; // Exponential smoothing for fluid motion

// MediaPipe confidence thresholds
export const MEDIAPIPE_LANDMARK_CONFIDENCE = 0.68; // Reliable finger tracking

// Motion detection
export const MIN_MOTION_THRESHOLD = 0.023; // ~15px / 640px normalized - captures subtle movements
export const CONSECUTIVE_FRAME_REQUIREMENT = 4; // ~130ms natural latency at 30fps
export const Z_AXIS_SMOOTHING = 0.80; // Smooth depth tracking
export const MAX_ACCELERATION = 0.156; // ~100px / 640px normalized - catches artifacts

// Hand tracking
export const HAND_SEPARATION_DISTANCE = 0.031; // ~20px / 640px normalized - prevents false merging
export const OCCLUSION_TOLERANCE_FRAMES = 3; // Continuous tracking through brief occlusions

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

// =============================================================================
// Translation Settings
// =============================================================================

export const SILENCE_TRIGGER_THRESHOLD = 1200; // ms of no motion to trigger translation
export const MAX_BUFFER_SIZE = 120; // max frames to buffer (4 sec at 30 FPS)

// Sign recognition settings
export const SIGN_RECOGNITION_FRAME_COUNT = 5; // number of video frames to send to Gemini
export const SIGN_RECOGNITION_MAX_LANDMARKS = 40; // max landmark frames to send

// =============================================================================
// Avatar & UI
// =============================================================================

// Avatar fallback
export const AVATAR_FALLBACK_URL = "/assets/video/fallback.mp4";

// UI constants
export const MODE_TOGGLE_SIZE = "h-20 w-20"; // Thumb zone button size
export const TRANSITION_DURATION = 0.3; // seconds for view transitions

// =============================================================================
// LSTM Dynamic Gesture Recognition
// =============================================================================

export const LSTM_WINDOW_SIZE = 32;           // frames (1.07s at 30fps)
export const LSTM_STRIDE = 15;                // frames between inferences
export const LSTM_MIN_MOTION_FRAMES = 8;      // minimum frames with motion to trigger
export const LSTM_CONFIDENCE_THRESHOLD = 0.7; // prediction threshold
export const LSTM_MODEL_PATH = '/models/asl_lstm_25.json';
export const LSTM_FEATURE_COUNT = 126;        // 21 landmarks × 3 coords × 2 hands

// Dynamic mode detection thresholds
// When LSTM buffer has accumulated motion frames, use extended stillness threshold
// to allow dynamic signs to complete before triggering translation
export const DYNAMIC_MODE_STILLNESS_THRESHOLD = 1500; // ms - extended stillness for dynamic signs
export const DYNAMIC_MODE_BUFFER_THRESHOLD = 8;       // frames - minimum motion frames to trigger dynamic mode

// LSTM vocabulary (25 common dynamic signs)
export const LSTM_VOCABULARY = [
  'HELLO', 'GOODBYE', 'PLEASE', 'THANK_YOU', 'SORRY',
  'WANT', 'NEED', 'HELP', 'LIKE', 'UNDERSTAND',
  'WHAT', 'WHERE', 'WHO', 'WHEN', 'WHY', 'HOW',
  'YES', 'NO', 'MAYBE', 'GOOD', 'BAD',
  'I', 'YOU', 'NAME', 'FINISH',
] as const;

export type LSTMSignClass = typeof LSTM_VOCABULARY[number];
