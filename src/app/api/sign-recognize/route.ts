import { NextRequest, NextResponse } from 'next/server';

import { SIGN_RECOGNITION_FRAME_COUNT } from '@/config/constants';
import { ASL_INTERPRETATION_PROMPT } from '@/lib/gemini/signRecognitionService';
import {
  formatLandmarksForPrompt,
  type LandmarkBuffer,
} from '@/lib/sign-recognition/shared';

import type { SignRecognizeResult } from '@/lib/sign-recognition/types';
import {
  getContentLengthBytes,
  SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES,
  validateSignRecognizeRequestBody,
} from '@/lib/sign-recognition/validation';
import { checkSlidingWindowRateLimit } from '@/lib/sign-recognition/rateLimit';
import { buildAugmentedPrompt } from '@/lib/sign-recognition/promptAugmentation';
import { applyRuntimeLearnedCorrections } from '@/lib/sign-recognition/learnedCorrections';
import {
  recordSignRecognitionEvent,
  type SignRecognitionEventStatus,
} from '@/lib/sign-recognition/monitoring';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export const runtime = 'nodejs';
export const maxDuration = 10;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Prefer OpenAI if configured, fall back to Gemini
type AIProvider = 'openai' | 'gemini' | 'none';
function getProvider(): AIProvider {
  if (OPENAI_API_KEY && OPENAI_API_KEY !== 'your-openai-api-key-here') return 'openai';
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your-gemini-api-key-here') return 'gemini';
  return 'none';
}

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

  // Strip code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '').trim();

  // Strip surrounding quotes
  cleaned = cleaned.replace(/^['"]|['"]$/g, '').trim();

  // If the response contains multiple lines, Gemini likely returned analysis.
  // Take only the LAST short line (usually the actual answer) or the first line
  // that looks like a clean translation (short, no colons/frame refs).
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    // Look for a line that's a clean short answer (no frame refs, no colons with numbers)
    const cleanLine = lines.find(l =>
      l.length < 80 &&
      !/^\d+[:.]/.test(l) &&
      !/frame/i.test(l) &&
      !/landmark/i.test(l) &&
      !/hand stays/i.test(l) &&
      !/analysis/i.test(l)
    );
    if (cleanLine) {
      cleaned = cleanLine;
    } else {
      // Fallback: take the last line (often the conclusion)
      cleaned = lines[lines.length - 1];
    }
  }

  // Strip numbered frame prefixes like "16:" or "Frame 5:"
  cleaned = cleaned.replace(/^(Frame\s*)?\d+\s*[:.]\s*/i, '').trim();

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strip common preamble phrases
  cleaned = cleaned.replace(
    /^(The person is signing |The sign means |This means |Translation: |The sign is |It looks like |Based on .{0,50}, |I think .{0,30} is )/i,
    ''
  );

  // Strip trailing period for single-word/short answers
  if (cleaned.length < 40) {
    cleaned = cleaned.replace(/\.$/, '');
  }

  return cleaned.trim();
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  let trackingSessionId: string | undefined;
  let trackingSampleId: string | undefined;
  let trackingProvider: AIProvider | undefined;
  let trackingPayloadBytes: number | undefined;

  const recordEvent = (
    status: SignRecognitionEventStatus,
    details: {
      source?: string;
      corrected?: boolean;
      confidence?: number;
      text?: string;
      error?: string;
    } = {}
  ) => {
    recordSignRecognitionEvent({
      sessionId: trackingSessionId ?? null,
      sampleId: trackingSampleId,
      provider: trackingProvider,
      status,
      latencyMs: Date.now() - requestStartedAt,
      payloadBytes: trackingPayloadBytes,
      ...details,
    });
  };

  try {
    const contentLength = getContentLengthBytes(request.headers);
    if (contentLength !== null) {
      trackingPayloadBytes = contentLength;
    }

    if (contentLength !== null && contentLength > SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES) {
      recordEvent('validation_error', { error: 'payload_too_large_header' });
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      recordEvent('validation_error', { error: 'invalid_json_body' });
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const approxBytes = Buffer.byteLength(JSON.stringify(rawBody), 'utf8');
    trackingPayloadBytes = approxBytes;
    if (approxBytes > SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES) {
      recordEvent('validation_error', { error: 'payload_too_large_computed' });
      return NextResponse.json(
        { success: false, error: 'Payload too large' },
        { status: 413 }
      );
    }

    const validated = validateSignRecognizeRequestBody(rawBody);
    if (!validated.ok) {
      recordEvent('validation_error', { error: validated.error.error });
      return NextResponse.json(
        { success: false, error: validated.error.error },
        { status: validated.error.status }
      );
    }

    const { frames, videoFrames, sessionId, lstmHint } = validated.value;
    trackingSessionId = sessionId;

    const ip = getClientIp(request);
    const rateKey = sessionId ? `session:${sessionId}` : ip ? `ip:${ip}` : 'unknown';

    const rate = checkSlidingWindowRateLimit(rateKey);
    if (!rate.allowed) {
      recordEvent('rate_limited', { error: 'local_rate_limit_exceeded' });
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
    trackingSampleId = sampleId;

    const provider = getProvider();
    trackingProvider = provider;
    if (provider === 'none') {
      console.error('[SignRecognize API] No AI API key configured');
      recordEvent('provider_unavailable', { error: 'missing_ai_api_key' });
      return NextResponse.json(
        { success: false, error: 'No AI API key configured. Set OPENAI_API_KEY or GEMINI_API_KEY in your environment.' },
        { status: 503 }
      );
    }

    console.log(`[SignRecognize API] Using provider: ${provider}`);

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

    // Build the text portions shared by both providers
    let landmarkSection = `\n\n## Landmark Data\nHere are the precise hand and face landmark coordinates:\n\n${landmarkText}`;
    if (lstmHint) {
      landmarkSection += `\n\n## Detection Context\n${lstmHint}\nUse this as supporting evidence but verify with the visual data.`;
    }
    const taskSection = '\n\n## Task\nBased on the video frames and landmark data above, what is being signed?\n\n**OUTPUT FORMAT**: Respond with ONLY the English word or short phrase. Do NOT include frame numbers, analysis, descriptions of hand positions, or explanations. Just the translation.\nExamples of correct output: "Hello", "Thank you", "Nice to meet you", "Y"\nExamples of WRONG output: "Frame 16: Hand stays relatively static", "The hand appears to be waving"';

    // Sample video frames
    const frameCount = Math.min(videoFrames.length, SIGN_RECOGNITION_FRAME_COUNT);
    const step = Math.max(1, Math.floor(videoFrames.length / frameCount));
    const sampledFrames: typeof videoFrames = [];
    for (let i = 0; i < videoFrames.length; i += step) {
      if (sampledFrames.length >= frameCount) break;
      sampledFrames.push(videoFrames[i]);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SIGN_RECOGNIZE_TIMEOUT_MS);

    try {
      let responseText = '';

      if (provider === 'openai') {
        // === OpenAI Chat Completions API (GPT-4o / GPT-4o-mini) ===
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [];

        contentParts.push({ type: 'text', text: prompt });

        if (sampledFrames.length > 0) {
          contentParts.push({ type: 'text', text: '\n\n## Video Frames\nHere are video frames showing the signing:' });
          for (const frame of sampledFrames) {
            contentParts.push({
              type: 'image_url',
              image_url: {
                url: frame.dataUrl, // OpenAI accepts data URLs directly
                detail: 'auto', // Let OpenAI choose resolution — ASL needs finger detail
              },
            });
          }
        }

        contentParts.push({ type: 'text', text: landmarkSection });
        contentParts.push({ type: 'text', text: taskSection });

        const response = await fetch(OPENAI_CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content: contentParts }],
            temperature: 0.2,
            max_tokens: 150,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[SignRecognize API] OpenAI error:', response.status, errorText);

          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') || '60';
            recordEvent('rate_limited', { error: 'openai_rate_limit' });
            return NextResponse.json(
              { success: false, error: 'OpenAI rate limit reached. Please wait a moment.', sampleId },
              { status: 429, headers: { 'Retry-After': retryAfter } }
            );
          }

          recordEvent('upstream_error', { error: `openai_${response.status}` });

          return NextResponse.json(
            { success: false, error: `OpenAI API error (${response.status}). Please try again.`, sampleId },
            { status: 502 }
          );
        }

        const data = await response.json();
        responseText = data.choices?.[0]?.message?.content || '';
      } else {
        // === Gemini API ===
        const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];
        parts.push({ text: prompt });

        if (sampledFrames.length > 0) {
          parts.push({ text: '\n\n## Video Frames\nHere are video frames showing the signing:' });
          for (const frame of sampledFrames) {
            const base64Data = frame.dataUrl.replace(/^data:image\/\w+;base64,/, '');
            parts.push({
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Data,
              },
            });
          }
        }

        parts.push({ text: landmarkSection });
        parts.push({ text: taskSection });

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
            recordEvent('rate_limited', { error: 'gemini_rate_limit' });
            return NextResponse.json(
              { success: false, error: 'Gemini rate limit reached. Please wait a moment.', sampleId },
              { status: 429, headers: { 'Retry-After': retryAfter } }
            );
          }

          recordEvent('upstream_error', { error: `gemini_${response.status}` });

          return NextResponse.json(
            { success: false, error: `Gemini API error (${response.status}). Please try again.`, sampleId },
            { status: 502 }
          );
        }

        const data = await response.json();
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      const originalText = cleanGeminiResponseText(responseText);
      const baseSource = (videoFrames.length > 0 ? `${provider}-vision` : provider) as SignRecognizeResult['source'];
      const baseConfidence = videoFrames.length > 0 ? 0.9 : 0.75;

      if (!originalText) {
        console.warn('[SignRecognize API] AI returned empty response');
        recordEvent('empty', {
          source: baseSource,
          confidence: 0,
          text: '',
        });
        return NextResponse.json(
          { success: true, text: '', originalText: '', corrected: false, confidence: 0, source: provider, sampleId },
        );
      }

      const corrected = await applyRuntimeLearnedCorrections(originalText);

      if (corrected.corrected) {
        console.log('[SignRecognize API] Runtime correction applied:', originalText, '->', corrected.text);
      } else {
        console.log('[SignRecognize API] No runtime correction for:', originalText);
      }

      const result: SignRecognizeResult = {
        text: corrected.text,
        originalText: corrected.originalText,
        corrected: corrected.corrected,
        confidence: baseConfidence,
        source: baseSource,
        sampleId,
      };

      recordEvent('success', {
        source: result.source,
        corrected: result.corrected,
        confidence: result.confidence,
        text: result.text,
      });

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[SignRecognize API] Request timed out');
        recordEvent('timeout', { error: 'request_timeout' });
        return NextResponse.json(
          { success: false, error: 'Sign recognition timed out. Please try a clearer sign.', sampleId },
          { status: 504 }
        );
      }

      console.error('[SignRecognize API] Error:', error);
      const message = error instanceof Error ? error.message : 'unknown_sign_recognition_error';
      recordEvent('internal_error', { error: message });
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
    recordEvent('internal_error', { error: message });
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
