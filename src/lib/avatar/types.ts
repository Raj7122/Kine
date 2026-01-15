// Avatar library types

export interface AvatarEntry {
  gloss_label: string;
  video_url: string;
  duration_ms: number;
  category: string;
  metadata: {
    signer_id: string;
    dialect: string;
  };
  // Flipbook fields (optional for backwards compatibility)
  frame_count?: number;
  fps?: number;
  storage_path?: string;
}

export interface AvatarLibrary {
  [gloss: string]: AvatarEntry;
}

export interface PlaybackItem {
  gloss: string;
  entry: AvatarEntry | null;
  isFallback: boolean;
}

export interface AvatarPlayerState {
  queue: PlaybackItem[];
  currentIndex: number;
  currentGloss: string | null;
  isPlaying: boolean;
  isLoading: boolean;
}

// Flipbook types
export interface FlipbookEntry {
  gloss: string;
  frameCount: number;
  fps: number;
  storagePath: string;
  frameUrls: string[];
  durationMs: number;
}

export interface FlipbookState {
  isLoading: boolean;
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  error: string | null;
}

export interface FlipbookPlaybackOptions {
  loop?: boolean;
  onComplete?: () => void;
  onFrameChange?: (frame: number) => void;
}

export const FALLBACK_DURATION_MS = 1000; // Duration to show "WORD NOT FOUND"
export const DEFAULT_FPS = 24;
export const FRAME_DURATION_MS = 1000 / DEFAULT_FPS; // ~41.67ms
