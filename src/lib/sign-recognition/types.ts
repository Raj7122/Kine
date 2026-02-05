import type { SignLandmarkData, VideoFrame } from '@/lib/gemini/signRecognitionService';

export type SignRecognizeSource = 'gemini' | 'gemini-vision' | 'mock';

export interface SignRecognizeRequestBody {
  frames: SignLandmarkData[];
  videoFrames: VideoFrame[];
  sessionId?: string;
}

export interface SignRecognizeResult {
  text: string;
  originalText: string;
  corrected: boolean;
  confidence: number;
  source: SignRecognizeSource;
  sampleId?: string;
}
