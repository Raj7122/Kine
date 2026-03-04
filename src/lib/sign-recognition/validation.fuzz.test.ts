import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import {
  validateSignRecognizeRequestBody,
  SIGN_RECOGNIZE_MAX_FRAMES,
  SIGN_RECOGNIZE_MAX_VIDEO_FRAMES,
} from './validation';

/**
 * Fuzz Tests for Validation
 * 
 * Property-based testing using fast-check to discover edge cases
 * that manual tests miss. Each property runs 1000 iterations.
 */

// --- Arbitraries ---

const validFrame = fc.record({
  timestamp: fc.double({ min: 0, max: 1e15, noNaN: true }),
});

const validVideoFrame = fc.record({
  dataUrl: fc.string({ minLength: 1, maxLength: 200 }).map((s: string) => `data:image/jpeg;base64,${s}`),
  timestamp: fc.double({ min: 0, max: 1e15, noNaN: true }),
});

const validSessionId = fc.string({ minLength: 1, maxLength: 128, unit: 'grapheme' });

const validLstmHint = fc.string({ minLength: 0, maxLength: 500, unit: 'grapheme' });

// --- Properties ---

describe('validation.fuzz - property: valid inputs always pass', () => {
  it('accepts any well-formed payload', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(
        fc.array(validFrame, { minLength: 1, maxLength: Math.min(50, SIGN_RECOGNIZE_MAX_FRAMES) }),
        fc.array(validVideoFrame, { minLength: 0, maxLength: Math.min(10, SIGN_RECOGNIZE_MAX_VIDEO_FRAMES) }),
        fc.option(validSessionId, { nil: undefined }),
        fc.option(validLstmHint, { nil: undefined }),
        (frames, videoFrames, sessionId, lstmHint) => {
          const body: Record<string, unknown> = { frames, videoFrames };
          if (sessionId !== undefined) body.sessionId = sessionId;
          if (lstmHint !== undefined) body.lstmHint = lstmHint;
          
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe('validation.fuzz - property: non-object inputs always fail', () => {
  it('rejects any primitive value', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.double(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined)
        ),
        (input) => {
          const result = validateSignRecognizeRequestBody(input);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('validation.fuzz - property: missing required fields always fail', () => {
  it('rejects objects without frames', () => {
    fc.assert(
      fc.property(
        fc.array(validVideoFrame, { minLength: 0, maxLength: 5 }),
        fc.option(validSessionId, { nil: undefined }),
        (videoFrames, sessionId) => {
          const body: Record<string, unknown> = { videoFrames };
          if (sessionId !== undefined) body.sessionId = sessionId;
          // No frames field
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('rejects objects without videoFrames', () => {
    fc.assert(
      fc.property(
        fc.array(validFrame, { minLength: 1, maxLength: 10 }),
        fc.option(validSessionId, { nil: undefined }),
        (frames, sessionId) => {
          const body: Record<string, unknown> = { frames };
          if (sessionId !== undefined) body.sessionId = sessionId;
          // No videoFrames field
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('validation.fuzz - property: oversized arrays always fail', () => {
  it('rejects frames exceeding max', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SIGN_RECOGNIZE_MAX_FRAMES + 1, max: SIGN_RECOGNIZE_MAX_FRAMES + 100 }),
        (count) => {
          const frames = Array.from({ length: count }, (_, i) => ({ timestamp: i }));
          const body = { frames, videoFrames: [] };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects videoFrames exceeding max', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: SIGN_RECOGNIZE_MAX_VIDEO_FRAMES + 1, max: SIGN_RECOGNIZE_MAX_VIDEO_FRAMES + 50 }),
        (count) => {
          const videoFrames = Array.from({ length: count }, (_, i) => ({
            dataUrl: 'data:image/jpeg;base64,abc',
            timestamp: i,
          }));
          const body = { frames: [{ timestamp: 1 }], videoFrames };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('validation.fuzz - property: invalid frame shapes always fail', () => {
  it('rejects frames with non-numeric timestamps', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.integer()),
          fc.dictionary(fc.string(), fc.integer())
        ),
        (badTimestamp) => {
          const body = {
            frames: [{ timestamp: badTimestamp }],
            videoFrames: [],
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('rejects frames that are not objects', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined)
        ),
        (badFrame) => {
          const body = {
            frames: [badFrame],
            videoFrames: [],
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('validation.fuzz - property: invalid videoFrame shapes always fail', () => {
  it('rejects videoFrames with non-string dataUrl', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.integer())
        ),
        (badDataUrl) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [{ dataUrl: badDataUrl, timestamp: 1 }],
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('rejects videoFrames with non-numeric timestamp', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined)
        ),
        (badTimestamp) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [{ dataUrl: 'data:image/jpeg;base64,abc', timestamp: badTimestamp }],
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('validation.fuzz - property: sessionId edge cases', () => {
  it('rejects empty sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: '',
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('rejects sessionId exceeding 128 chars', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 129, max: 500 }),
        (len) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [],
            sessionId: 'a'.repeat(len),
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts sessionId at exactly 128 chars', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'a'.repeat(128),
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects non-string sessionId types', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.dictionary(fc.string(), fc.string())
        ),
        (badSessionId) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [],
            sessionId: badSessionId,
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('validation.fuzz - property: lstmHint edge cases', () => {
  it('rejects lstmHint exceeding 500 chars', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 501, max: 1000 }),
        (len) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [],
            lstmHint: 'x'.repeat(len),
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts lstmHint at exactly 500 chars', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      lstmHint: 'x'.repeat(500),
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects non-string lstmHint types', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.dictionary(fc.string(), fc.string())
        ),
        (badHint) => {
          const body = {
            frames: [{ timestamp: 1 }],
            videoFrames: [],
            lstmHint: badHint,
          };
          const result = validateSignRecognizeRequestBody(body);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('validation.fuzz - property: never crashes on arbitrary input', () => {
  it('does not throw on any JSON-serializable value', { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(
        fc.anything({
          withBoxedValues: true,
          withMap: false,
          withSet: false,
          withBigInt: false,
          withTypedArray: false,
          withSparseArray: false,
          withUnicodeString: true,
        }),
        (input) => {
          // Should never throw — always returns ok:true or ok:false
          expect(() => validateSignRecognizeRequestBody(input)).not.toThrow();
        }
      ),
      { numRuns: 2000 }
    );
  });
});
