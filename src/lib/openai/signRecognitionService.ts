/**
 * OpenAI GPT-4o Sign Recognition Service
 * Multimodal sign language interpretation with sentence-level support
 *
 * Uses server-side API route for security (API key not exposed to client)
 *
 * Shared types & utilities live in @/lib/sign-recognition/shared.
 */

import { formatLandmarksForPrompt, type LandmarkBuffer, type VideoFrame } from '@/lib/sign-recognition/shared';

// Re-export shared types so existing barrel imports keep working
export type { SignLandmarkData, VideoFrame, LandmarkBuffer } from '@/lib/sign-recognition/shared';
export { captureVideoFrame, createLandmarkBuffer } from '@/lib/sign-recognition/shared';

// Check if OpenAI is configured (will be validated server-side)
export const isOpenAIConfigured = true; // Always try, server will return error if not configured

/**
 * Sign recognition result (OpenAI-specific)
 */
export interface SignRecognitionResult {
  text: string;
  confidence: number;
  source: 'openai' | 'openai-vision' | 'mock';
  unclear?: boolean;
}

/**
 * Recognize sign language using OpenAI GPT-4o via API route
 */
export async function recognizeSignWithOpenAI(
  buffer: LandmarkBuffer,
  lstmHint?: string | null
): Promise<SignRecognitionResult> {
  console.log('[OpenAI SignRecognition] Processing', buffer.frames.length, 'landmark frames,', buffer.videoFrames.length, 'video frames');

  if (lstmHint) {
    console.log('[OpenAI SignRecognition] LSTM hint:', lstmHint);
  }

  try {
    const landmarkText = formatLandmarksForPrompt(buffer as LandmarkBuffer);

    // Sample video frames evenly (up to 20 for better temporal context)
    const maxFrames = 20;
    const sampledFrames: VideoFrame[] = [];
    const step = Math.max(1, Math.floor(buffer.videoFrames.length / maxFrames));

    for (let i = 0; i < buffer.videoFrames.length; i += step) {
      if (sampledFrames.length >= maxFrames) break;
      sampledFrames.push(buffer.videoFrames[i] as VideoFrame);
    }

    console.log('[OpenAI SignRecognition] Sending', sampledFrames.length, 'video frames to API');

    // Call our secure API route
    const response = await fetch('/api/openai/recognize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoFrames: sampledFrames,
        landmarkText,
        lstmHint,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[OpenAI SignRecognition] API error:', response.status, errorData);
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[OpenAI SignRecognition] GPT-4o response:', result.text || '(empty)', result.unclear ? '(unclear)' : '', '| confidence:', result.confidence);

    // Handle unclear responses - don't fall back to random text
    if (result.unclear || !result.text) {
      return {
        text: '',
        confidence: 0,
        source: result.source || 'openai-vision',
        unclear: true,
      };
    }

    return {
      text: result.text,
      confidence: result.confidence || 0.75,
      source: result.source || 'openai',
    };
  } catch (error) {
    console.error('[OpenAI SignRecognition] Error:', error);
    throw error;
  }
}

