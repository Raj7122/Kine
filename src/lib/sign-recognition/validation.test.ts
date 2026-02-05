import { describe, it, expect } from 'vitest';

import {
  getContentLengthBytes,
  validateSignRecognizeRequestBody,
  SIGN_RECOGNIZE_MAX_FRAMES,
  SIGN_RECOGNIZE_MAX_VIDEO_FRAMES,
} from './validation';

describe('getContentLengthBytes', () => {
  it('returns null when content-length is missing', () => {
    const headers = new Headers();
    expect(getContentLengthBytes(headers)).toBeNull();
  });

  it('returns null when content-length is invalid', () => {
    const headers = new Headers({ 'content-length': 'nope' });
    expect(getContentLengthBytes(headers)).toBeNull();
  });

  it('returns null when content-length is negative', () => {
    const headers = new Headers({ 'content-length': '-1' });
    expect(getContentLengthBytes(headers)).toBeNull();
  });

  it('parses valid content-length', () => {
    const headers = new Headers({ 'content-length': '123' });
    expect(getContentLengthBytes(headers)).toBe(123);
  });
});

describe('validateSignRecognizeRequestBody', () => {
  it('accepts a minimal valid payload', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'session-1',
    };

    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.frames).toHaveLength(1);
      expect(result.value.videoFrames).toHaveLength(0);
      expect(result.value.sessionId).toBe('session-1');
    }
  });

  it('rejects non-object body', () => {
    const result = validateSignRecognizeRequestBody(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(400);
    }
  });

  it('rejects missing frames array', () => {
    const result = validateSignRecognizeRequestBody({ videoFrames: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects missing videoFrames array', () => {
    const result = validateSignRecognizeRequestBody({ frames: [{ timestamp: 1 }] });
    expect(result.ok).toBe(false);
  });

  it('rejects empty frames', () => {
    const result = validateSignRecognizeRequestBody({ frames: [], videoFrames: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('frames is required');
    }
  });

  it('rejects too many landmark frames', () => {
    const frames = Array.from({ length: SIGN_RECOGNIZE_MAX_FRAMES + 1 }, () => ({ timestamp: 1 }));
    const result = validateSignRecognizeRequestBody({ frames, videoFrames: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('frames exceeds max allowed');
    }
  });

  it('rejects too many video frames', () => {
    const videoFrames = Array.from({ length: SIGN_RECOGNIZE_MAX_VIDEO_FRAMES + 1 }, () => ({
      dataUrl: 'data:image/jpeg;base64,abc',
      timestamp: 1,
    }));

    const result = validateSignRecognizeRequestBody({ frames: [{ timestamp: 1 }], videoFrames });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('videoFrames exceeds max allowed');
    }
  });

  it('rejects invalid frame shape', () => {
    const result = validateSignRecognizeRequestBody({
      frames: [{ timestamp: 'bad' }],
      videoFrames: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('Invalid frame in frames array');
    }
  });

  it('rejects invalid video frame shape', () => {
    const result = validateSignRecognizeRequestBody({
      frames: [{ timestamp: 1 }],
      videoFrames: [{ dataUrl: 123, timestamp: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('Invalid frame in videoFrames array');
    }
  });

  it('rejects invalid sessionId', () => {
    const result = validateSignRecognizeRequestBody({
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toContain('Invalid sessionId');
    }
  });
});
