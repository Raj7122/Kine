import type { SignLandmarkData, VideoFrame } from '@/lib/gemini/signRecognitionService';

export type SignRecognizeSource =
  | 'gemini'
  | 'gemini-vision'
  | 'openai'
  | 'openai-vision'
  | 'gesture'
  | 'mock';

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
