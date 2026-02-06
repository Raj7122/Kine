import { NextRequest, NextResponse } from 'next/server';

import { USE_MOCK_DATA, SIGN_RECOGNITION_FRAME_COUNT } from '@/config/constants';
import {
  ASL_INTERPRETATION_PROMPT,
  formatLandmarksForPrompt,
  type LandmarkBuffer,
} from '@/lib/gemini/signRecognitionService';

import type { SignRecognizeResult } from '@/lib/sign-recognition/types';
import {
  getContentLengthBytes,
  SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES,
  validateSignRecognizeRequestBody,
} from '@/lib/sign-recognition/validation';
import { checkSlidingWindowRateLimit } from '@/lib/sign-recognition/rateLimit';
import { buildAugmentedPrompt } from '@/lib/sign-recognition/promptAugmentation';
import { applyRuntimeLearnedCorrections } from '@/lib/sign-recognition/learnedCorrections';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export const runtime = 'nodejs';
export const maxDuration = 10;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const SIGN_RECOGNIZE_TIMEOUT_MS = 9_000;
const SIGN_RECOGNIZE_PROMPT_VERSION = 1;
const SIGN_RECOGNIZE_SAMPLE_BUCKET = 'sign-recognition-samples';

async function persistSignRecognitionSample(
  sessionId: string | undefined,
  frames: LandmarkBuffer['frames'],
  videoFrames: LandmarkBuffer['videoFrames']
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const sampleId = crypto.randomUUID();
  const sessionIdToStore = sessionId?.trim() ? sessionId.trim() : 'unknown';

  try {
    const { error: insertError } = await supabase
      .from('sign_recognition_samples')
      .insert({
        id: sampleId,
        session_id: sessionIdToStore,
        frames_json: frames,
        video_frames_ref: null,
      });

    if (insertError) {
      console.warn('[SignRecognize API] Failed to persist sample row:', insertError.message);
      return null;
    }

    if (videoFrames.length === 0) {
      return sampleId;
    }

    const videoFramesRef = `${sessionIdToStore}/${sampleId}/video_frames.json`;
    const payload = Buffer.from(JSON.stringify({ videoFrames }), 'utf8');

    const { error: uploadError } = await supabase.storage
      .from(SIGN_RECOGNIZE_SAMPLE_BUCKET)
      .upload(videoFramesRef, payload, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadError) {
      console.warn('[SignRecognize API] Failed to upload videoFrames:', uploadError.message);
      return sampleId;
    }

    const { error: updateError } = await supabase
      .from('sign_recognition_samples')
      .update({ video_frames_ref: videoFramesRef })
      .eq('id', sampleId);

    if (updateError) {
      console.warn('[SignRecognize API] Failed to set video_frames_ref:', updateError.message);
    }

    return sampleId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[SignRecognize API] Unexpected sample persistence failure:', message);
    return null;
  }
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  return null;
}

function cleanGeminiResponseText(responseText: string): string {
  let cleaned = responseText.trim();

  cleaned = cleaned.replace(/```[\s\S]*?```/g, '').trim();
  cleaned = cleaned.replace(/^['"]|['"]$/g, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(
    /^(The person is signing |The sign means |This means |Translation: )/i,
    ''
  );

  return cleaned.trim();
}

function getMockResult(): SignRecognizeResult {
  const mockPhrases = ['Hello', 'Thank you', 'How are you?', 'Nice to meet you', 'Please help me', 'Yes', 'No'];
  const text = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
  return {
    text,
    originalText: text,
    corrected: false,
    confidence: 0.5,
    source: 'mock',
  };
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = getContentLengthBytes(request.headers);
    if (contentLength !== null && contentLength > SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const approxBytes = Buffer.byteLength(JSON.stringify(rawBody), 'utf8');
    if (approxBytes > SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }

    const validated = validateSignRecognizeRequestBody(rawBody);
    if (!validated.ok) {
      return NextResponse.json(
        { success: false, error: validated.error.error },
        { status: validated.error.status }
      );
    }

    const { frames, videoFrames, sessionId } = validated.value;

    const ip = getClientIp(request);
    const rateKey = sessionId ? `session:${sessionId}` : ip ? `ip:${ip}` : 'unknown';

    const rate = checkSlidingWindowRateLimit(rateKey);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfterSeconds ?? 60),
          },
        }
      );
    }

    const persistedSampleId = await persistSignRecognitionSample(sessionId, frames, videoFrames);
    const sampleId = persistedSampleId ?? undefined;

    if (USE_MOCK_DATA) {
      console.warn('[SignRecognize API] USE_MOCK_DATA is enabled — returning mock data');
      return NextResponse.json({ success: true, ...getMockResult(), sampleId });
    }

    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-api-key-here') {
      console.error('[SignRecognize API] GEMINI_API_KEY is not configured');
      return NextResponse.json(
        { success: false, error: 'Gemini API key is not configured. Set GEMINI_API_KEY in your environment.' },
        { status: 503 }
      );
    }

    const buffer: LandmarkBuffer = {
      frames,
      videoFrames,
      startTime: frames[0]?.timestamp || Date.now(),
      endTime: frames[frames.length - 1]?.timestamp || Date.now(),
    };

    const landmarkText = formatLandmarksForPrompt(buffer);
    const { prompt } = await buildAugmentedPrompt(
      ASL_INTERPRETATION_PROMPT,
      SIGN_RECOGNIZE_PROMPT_VERSION
    );

    const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];
    parts.push({ text: prompt });

    if (videoFrames.length > 0) {
      const frameCount = Math.min(videoFrames.length, SIGN_RECOGNITION_FRAME_COUNT);
      const step = Math.max(1, Math.floor(videoFrames.length / frameCount));

      parts.push({ text: '\n\n## Video Frames\nHere are video frames showing the signing:' });

      for (let i = 0; i < videoFrames.length; i += step) {
        const inlineCount = parts.filter((p) => 'inline_data' in p).length;
        if (inlineCount >= frameCount) break;

        const frame = videoFrames[i];
        const base64Data = frame.dataUrl.replace(/^data:image\/\w+;base64,/, '');

        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64Data,
          },
        });
      }
    }

    parts.push({
      text: `\n\n## Landmark Data\nHere are the precise hand and face landmark coordinates:\n\n${landmarkText}`,
    });

    parts.push({
      text: '\n\n## Task\nBased on the video frames and landmark data above, what is being signed? Respond with ONLY the English translation.',
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SIGN_RECOGNIZE_TIMEOUT_MS);

    try {
      const response = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 150,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SignRecognize API] Gemini error:', response.status, errorText);

        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || '60';
          return NextResponse.json(
            { success: false, error: 'Gemini API rate limit reached. Please wait a moment before signing again.', sampleId },
            { status: 429, headers: { 'Retry-After': retryAfter } }
          );
        }

        return NextResponse.json(
          { success: false, error: `Gemini API error (${response.status}). Please try again.`, sampleId },
          { status: 502 }
        );
      }

      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const originalText = cleanGeminiResponseText(responseText) || 'Hello';

      const baseSource = videoFrames.length > 0 ? 'gemini-vision' : 'gemini';
      const baseConfidence = videoFrames.length > 0 ? 0.9 : 0.75;

      const corrected = await applyRuntimeLearnedCorrections(originalText);

      const result: SignRecognizeResult = {
        text: corrected.text,
        originalText: corrected.originalText,
        corrected: corrected.corrected,
        confidence: baseConfidence,
        source: baseSource,
        sampleId,
      };

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[SignRecognize API] Gemini request timed out');
        return NextResponse.json(
          { success: false, error: 'Sign recognition timed out. Please try a clearer sign.', sampleId },
          { status: 504 }
        );
      }

      console.error('[SignRecognize API] Error:', error);
      return NextResponse.json(
        { success: false, error: 'Sign recognition failed. Please try again.', sampleId },
        { status: 500 }
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error('[SignRecognize API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
