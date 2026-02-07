import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recognizeSignWithGemini } from './geminiClient';
import type { SignRecognizeResult } from './types';

// Minimal mock frame data
function mockFrame(ts: number) {
  return { hands: null, face: null, timestamp: ts };
}

function mockVideoFrame(ts: number) {
  return { dataUrl: 'data:image/jpeg;base64,/9j/fake', timestamp: ts };
}

describe('recognizeSignWithGemini', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls /api/sign-recognize with correct payload and returns SignRecognizeResult', async () => {
    const serverResult: SignRecognizeResult = {
      text: 'Hello',
      originalText: 'Hello',
      corrected: false,
      confidence: 0.9,
      source: 'gemini-vision',
      sampleId: 'sample-123',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, ...serverResult }),
      headers: new Headers(),
    });

    const frames = [mockFrame(1000), mockFrame(1033), mockFrame(1066)];
    const videoFrames = [mockVideoFrame(1000), mockVideoFrame(1033)];

    const result = await recognizeSignWithGemini(frames, videoFrames, {
      sessionId: 'sess-1',
      lstmHint: 'HELLO',
    });

    expect(result).toEqual(serverResult);

    // Verify fetch was called with correct args
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/sign-recognize');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.frames).toHaveLength(3);
    expect(body.videoFrames).toHaveLength(2);
    expect(body.sessionId).toBe('sess-1');
  });

  it('trims frames to maxLandmarkFrames and maxVideoFrames', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        text: 'Yes',
        originalText: 'Yes',
        corrected: false,
        confidence: 0.85,
        source: 'gemini',
      }),
      headers: new Headers(),
    });

    const frames = Array.from({ length: 100 }, (_, i) => mockFrame(i));
    const videoFrames = Array.from({ length: 50 }, (_, i) => mockVideoFrame(i));

    await recognizeSignWithGemini(frames, videoFrames, {
      maxLandmarkFrames: 10,
      maxVideoFrames: 5,
    });

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.frames).toHaveLength(10);
    expect(body.videoFrames).toHaveLength(5);
  });

  it('throws on HTTP error with status and retryAfter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limit exceeded' }),
      headers: new Headers({ 'Retry-After': '30' }),
    });

    try {
      await recognizeSignWithGemini([mockFrame(1)], []);
      expect.unreachable('Should have thrown');
    } catch (err) {
      const e = err as Error & { status: number; retryAfter: string | null };
      expect(e.message).toBe('Rate limit exceeded');
      expect(e.status).toBe(429);
      expect(e.retryAfter).toBe('30');
    }
  });

  it('throws on HTTP 503 when Gemini API key is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Gemini API key is not configured.' }),
      headers: new Headers(),
    });

    await expect(
      recognizeSignWithGemini([mockFrame(1)], [])
    ).rejects.toThrow('Gemini API key is not configured.');
  });

  it('throws when response.success is false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Internal processing error' }),
      headers: new Headers(),
    });

    await expect(
      recognizeSignWithGemini([mockFrame(1)], [])
    ).rejects.toThrow('Internal processing error');
  });

  it('defaults missing fields in successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, text: 'Thank you' }),
      headers: new Headers(),
    });

    const result = await recognizeSignWithGemini([mockFrame(1)], []);

    expect(result.text).toBe('Thank you');
    expect(result.originalText).toBe('Thank you');
    expect(result.corrected).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('gemini');
    expect(result.sampleId).toBeUndefined();
  });

  it('handles network fetch failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      recognizeSignWithGemini([mockFrame(1)], [])
    ).rejects.toThrow('Failed to fetch');
  });
});
