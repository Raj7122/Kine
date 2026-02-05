import { SIGN_RECOGNITION_FRAME_COUNT, SIGN_RECOGNITION_MAX_LANDMARKS } from '@/config/constants';
import type { SignRecognizeRequestBody } from './types';

export const SIGN_RECOGNIZE_MAX_FRAMES = SIGN_RECOGNITION_MAX_LANDMARKS;
export const SIGN_RECOGNIZE_MAX_VIDEO_FRAMES = SIGN_RECOGNITION_FRAME_COUNT * 2;

// Vercel request body limit is ~4.5MB for many setups; keep a conservative ceiling.
export const SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES = 4_500_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export interface ValidationError {
  error: string;
  status: number;
}

export function getContentLengthBytes(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function validateSignRecognizeRequestBody(
  body: unknown
): { ok: true; value: SignRecognizeRequestBody } | { ok: false; error: ValidationError } {
  if (!isRecord(body)) {
    return { ok: false, error: { error: 'Invalid JSON body', status: 400 } };
  }

  const frames = body.frames;
  const videoFrames = body.videoFrames;
  const sessionId = body.sessionId;

  if (!Array.isArray(frames)) {
    return { ok: false, error: { error: 'frames must be an array', status: 400 } };
  }

  if (!Array.isArray(videoFrames)) {
    return { ok: false, error: { error: 'videoFrames must be an array', status: 400 } };
  }

  if (frames.length === 0) {
    return { ok: false, error: { error: 'frames is required', status: 400 } };
  }

  if (frames.length > SIGN_RECOGNIZE_MAX_FRAMES) {
    return {
      ok: false,
      error: {
        error: `frames exceeds max allowed (${SIGN_RECOGNIZE_MAX_FRAMES})`,
        status: 400,
      },
    };
  }

  if (videoFrames.length > SIGN_RECOGNIZE_MAX_VIDEO_FRAMES) {
    return {
      ok: false,
      error: {
        error: `videoFrames exceeds max allowed (${SIGN_RECOGNIZE_MAX_VIDEO_FRAMES})`,
        status: 400,
      },
    };
  }

  // Minimal shape validation (avoid deep validation cost)
  for (const frame of frames) {
    if (!isRecord(frame) || !isNumber(frame.timestamp)) {
      return { ok: false, error: { error: 'Invalid frame in frames array', status: 400 } };
    }
  }

  for (const vf of videoFrames) {
    if (!isRecord(vf) || !isString(vf.dataUrl) || !isNumber(vf.timestamp)) {
      return { ok: false, error: { error: 'Invalid frame in videoFrames array', status: 400 } };
    }
  }

  if (sessionId !== undefined) {
    if (!isString(sessionId) || sessionId.length === 0 || sessionId.length > 128) {
      return { ok: false, error: { error: 'Invalid sessionId', status: 400 } };
    }
  }

  return {
    ok: true,
    value: {
      frames: frames as SignRecognizeRequestBody['frames'],
      videoFrames: videoFrames as SignRecognizeRequestBody['videoFrames'],
      sessionId: sessionId as SignRecognizeRequestBody['sessionId'],
    },
  };
}
