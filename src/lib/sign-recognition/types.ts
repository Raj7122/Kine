import type { SignLandmarkData, VideoFrame } from './shared';

export type SignRecognizeSource =
  | 'gemini'
  | 'gemini-vision'
  | 'lstm'
  | 'openai'
  | 'openai-vision'
  | 'gesture';

export interface SignRecognizeRequestBody {
  frames: SignLandmarkData[];
  videoFrames: VideoFrame[];
  sessionId?: string;
  lstmHint?: string | null;
}

export interface SignRecognizeResult {
  text: string;
  originalText: string;
  corrected: boolean;
  confidence: number;
  source: SignRecognizeSource;
  sampleId?: string;
}
