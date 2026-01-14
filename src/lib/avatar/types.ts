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

export const FALLBACK_DURATION_MS = 1000; // Duration to show "WORD NOT FOUND"
