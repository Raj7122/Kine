// Configuration constants for Kine app
// Phase 1-4: USE_MOCK_DATA = true
// Phase 5: Set to false for real backend

export const USE_MOCK_DATA = false;

// MediaPipe configuration
export const LANDMARK_SAMPLING_RATE = 100; // ms between inference runs

// Translation trigger settings
export const SILENCE_TRIGGER_THRESHOLD = 1500; // ms of no motion to trigger translation
export const MAX_BUFFER_SIZE = 50; // max frames to buffer

// Avatar fallback
export const AVATAR_FALLBACK_URL = "/assets/video/fallback.mp4";

// UI constants
export const MODE_TOGGLE_SIZE = "h-20 w-20"; // Thumb zone button size
export const TRANSITION_DURATION = 0.3; // seconds for view transitions
