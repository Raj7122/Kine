// Configuration constants for Kine app
// Phase 1-4: USE_MOCK_DATA = true
// Phase 5: Set to false for real backend

export const USE_MOCK_DATA = false;

// MediaPipe configuration
export const LANDMARK_SAMPLING_RATE = 50; // ms between inference runs (20 FPS for better motion capture)

// Translation trigger settings
export const SILENCE_TRIGGER_THRESHOLD = 1200; // ms of no motion to trigger translation (faster response)
export const MAX_BUFFER_SIZE = 80; // max frames to buffer (4 sec at 20 FPS)

// Sign recognition settings
export const SIGN_RECOGNITION_FRAME_COUNT = 5; // number of video frames to send to Gemini
export const SIGN_RECOGNITION_MAX_LANDMARKS = 40; // max landmark frames to send

// Avatar fallback
export const AVATAR_FALLBACK_URL = "/assets/video/fallback.mp4";

// UI constants
export const MODE_TOGGLE_SIZE = "h-20 w-20"; // Thumb zone button size
export const TRANSITION_DURATION = 0.3; // seconds for view transitions
