/**
 * Client-side Gemini Sign Recognition Service
 * Calls the server-side /api/sign-recognize route which uses Gemini 3.0 Flash
 * with prompt augmentation and runtime learned corrections.
 */

import type { SignLandmarkData, VideoFrame } from './shared';
import type { SignRecognizeResult } from './types';

export interface GeminiRecognitionOptions {
  sessionId?: string;
  lstmHint?: string | null;
  maxLandmarkFrames?: number;
  maxVideoFrames?: number;
}

/**
 * Recognize sign language by calling the Gemini-powered /api/sign-recognize route.
 *
 * Returns a full SignRecognizeResult on success.
 * On network/server errors the promise rejects with a descriptive Error.
 */
export async function recognizeSignWithGemini(
  frames: SignLandmarkData[],
  videoFrames: VideoFrame[],
  options: GeminiRecognitionOptions = {}
): Promise<SignRecognizeResult> {
  const {
    sessionId,
    lstmHint,
    maxLandmarkFrames = 60,
    maxVideoFrames = 20,
  } = options;

  const trimmedFrames = frames.slice(-maxLandmarkFrames);
  const trimmedVideo = videoFrames.slice(-maxVideoFrames);

  console.log(
    '[GeminiClient] Sending to /api/sign-recognize:',
    { landmarkFrames: trimmedFrames.length, videoFrames: trimmedVideo.length, hasHint: !!lstmHint }
  );

  const response = await fetch('/api/sign-recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frames: trimmedFrames,
      videoFrames: trimmedVideo,
      sessionId,
      lstmHint: lstmHint || null,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    const retryAfter = response.headers.get('Retry-After');

    const err = new Error(data.error || `Sign recognition failed (${response.status})`);
    (err as Error & { status: number; retryAfter: string | null }).status = response.status;
    (err as Error & { retryAfter: string | null }).retryAfter = retryAfter;
    throw err;
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Sign recognition returned unsuccessful result');
  }

  const result: SignRecognizeResult = {
    text: data.text ?? '',
    originalText: data.originalText ?? data.text ?? '',
    corrected: data.corrected ?? false,
    confidence: data.confidence ?? 0,
    source: data.source ?? 'gemini',
    sampleId: data.sampleId,
  };

  console.log(
    `[GeminiClient] Result: "${result.text}" (source: ${result.source}, confidence: ${result.confidence})`
  );

  return result;
}
