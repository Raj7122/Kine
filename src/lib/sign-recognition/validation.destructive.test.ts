import { describe, it, expect } from 'vitest';

import {
  getContentLengthBytes,
  validateSignRecognizeRequestBody,
  SIGN_RECOGNIZE_MAX_FRAMES,
  SIGN_RECOGNIZE_MAX_VIDEO_FRAMES,
  SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES,
} from './validation';

/**
 * Destructive Tests for Validation
 * 
 * These tests intentionally break assumptions to find edge cases
 * and vulnerabilities in input validation.
 */

describe('validation.destructive - getContentLengthBytes', () => {
  it('handles extremely large content-length values', () => {
    const headers = new Headers({ 'content-length': '9007199254740991' }); // Number.MAX_SAFE_INTEGER
    expect(getContentLengthBytes(headers)).toBe(9007199254740991);
  });

  it('handles content-length at exact limit boundary', () => {
    const headers = new Headers({ 'content-length': String(SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES) });
    expect(getContentLengthBytes(headers)).toBe(SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES);
  });

  it('rejects content-length just over limit', () => {
    const headers = new Headers({ 'content-length': String(SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES + 1) });
    expect(getContentLengthBytes(headers)).toBe(SIGN_RECOGNIZE_MAX_PAYLOAD_BYTES + 1);
  });

  it('handles floating point content-length', () => {
    const headers = new Headers({ 'content-length': '123.456' });
    expect(getContentLengthBytes(headers)).toBe(123.456);
  });

  it('handles scientific notation content-length', () => {
    const headers = new Headers({ 'content-length': '1e6' });
    expect(getContentLengthBytes(headers)).toBe(1000000);
  });

  it('handles zero content-length', () => {
    const headers = new Headers({ 'content-length': '0' });
    expect(getContentLengthBytes(headers)).toBe(0);
  });

  it('handles leading zeros in content-length', () => {
    const headers = new Headers({ 'content-length': '000123' });
    expect(getContentLengthBytes(headers)).toBe(123);
  });

  it('handles whitespace-padded content-length', () => {
    const headers = new Headers({ 'content-length': '  123  ' });
    // Headers API may trim or not - test actual behavior
    const result = getContentLengthBytes(headers);
    expect(result === 123 || result === null).toBe(true);
  });

  it('handles Infinity content-length', () => {
    const headers = new Headers({ 'content-length': 'Infinity' });
    expect(getContentLengthBytes(headers)).toBeNull();
  });

  it('handles NaN content-length', () => {
    const headers = new Headers({ 'content-length': 'NaN' });
    expect(getContentLengthBytes(headers)).toBeNull();
  });

  it('handles empty string content-length', () => {
    const headers = new Headers({ 'content-length': '' });
    expect(getContentLengthBytes(headers)).toBeNull();
  });
});

describe('validation.destructive - payload size attacks', () => {
  it('accepts payload with max frames and lstmHint at boundary (500 chars)', () => {
    const frame = { timestamp: 1 };
    const body: { frames: typeof frame[]; videoFrames: never[]; sessionId: string; lstmHint: string } = {
      frames: Array.from({ length: SIGN_RECOGNIZE_MAX_FRAMES }, () => frame),
      videoFrames: [],
      sessionId: 'test',
      lstmHint: '',
    };
    body.lstmHint = 'x'.repeat(500);
    
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles deeply nested objects in frames', () => {
    const body = {
      frames: [{
        timestamp: 1,
        nested: { deep: { deeper: { deepest: 'value' } } }
      }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Extra fields ignored
  });

  it('handles frames with circular references gracefully', () => {
    const frame: Record<string, unknown> = { timestamp: 1 };
    frame.self = frame; // Circular ref
    
    const body = {
      frames: [frame],
      videoFrames: [],
    };
    
    // Should not crash on circular reference
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles videoFrames with massive dataURL', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(1000000),
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    // Should validate structure, not content size
    expect(result.ok).toBe(true);
  });

  it('handles null bytes in strings', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'test\x00null',
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Null bytes allowed in validation
  });
});

describe('validation.destructive - type confusion attacks', () => {
  it('handles frames as array-like object', () => {
    const arrayLike = { length: 1, 0: { timestamp: 1 } };
    const body = {
      frames: arrayLike,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // Not a real array
  });

  it('handles timestamp as numeric string', () => {
    const body = {
      frames: [{ timestamp: '123' }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // String, not number
  });

  it('handles timestamp as boolean', () => {
    const body = {
      frames: [{ timestamp: true }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // Boolean, not number
  });

  it('handles timestamp as object', () => {
    const body = {
      frames: [{ timestamp: { valueOf: () => 1 } }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // Object, not number
  });

  it('handles sessionId as number', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 12345,
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // Number, not string
  });

  it('handles sessionId as object with toString', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: { toString: () => 'valid' },
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // Object, not string
  });

  it('handles Symbol in frames array', () => {
    const body = {
      frames: [Symbol('test')],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('handles BigInt timestamp', () => {
    const body = {
      frames: [{ timestamp: BigInt(1) }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false); // BigInt, not number
  });

  it('handles Function in frames', () => {
    const body = {
      frames: [() => ({ timestamp: 1 })],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('handles undefined in required frames array', () => {
    const body = {
      frames: undefined,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('handles null in required frames array', () => {
    const body = {
      frames: null,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });
});

describe('validation.destructive - unicode & encoding edge cases', () => {
  it('handles emoji in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'test🎉🎊',
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles RTL (right-to-left) text in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'שלוםtest',
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles zero-width characters in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'test\u200B\u200C\u200D', // ZWSP, ZWNJ, ZWJ
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles combining characters in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'e\u0301\u0302\u0303', // é with combining marks
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles surrogate pair edge case in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: '\uD800\uDFFF', // Surrogate pair
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects sessionId exceeding 128 chars with unicode', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'a'.repeat(127) + '🎉', // 127 ASCII + 2-byte emoji
    };
    const result = validateSignRecognizeRequestBody(body);
    // Should be rejected based on code unit length
    expect(result.ok).toBe(false);
  });

  it('handles control characters in sessionId', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      sessionId: 'test\x01\x02\x03', // Control chars
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles full-width unicode in lstmHint', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      lstmHint: 'こんにちは', // Japanese full-width
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles extremely long unicode lstmHint', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
      lstmHint: 'あ'.repeat(500), // 500 Japanese chars
    };
    // Should be at limit exactly
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });
});

describe('validation.destructive - array boundary conditions', () => {
  it('handles exactly max frames boundary', () => {
    const frames = Array.from({ length: SIGN_RECOGNIZE_MAX_FRAMES }, (_, i) => ({ timestamp: i }));
    const body = {
      frames,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects max+1 frames boundary', () => {
    const frames = Array.from({ length: SIGN_RECOGNIZE_MAX_FRAMES + 1 }, (_, i) => ({ timestamp: i }));
    const body = {
      frames,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('handles exactly max videoFrames boundary', () => {
    const videoFrames = Array.from({ length: SIGN_RECOGNIZE_MAX_VIDEO_FRAMES }, (_, i) => ({
      dataUrl: 'data:image/jpeg;base64,abc',
      timestamp: i,
    }));
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames,
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('rejects max+1 videoFrames boundary', () => {
    const videoFrames = Array.from({ length: SIGN_RECOGNIZE_MAX_VIDEO_FRAMES + 1 }, (_, i) => ({
      dataUrl: 'data:image/jpeg;base64,abc',
      timestamp: i,
    }));
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames,
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(false);
  });

  it('handles single frame (minimum valid)', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles empty videoFrames (minimum valid)', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles sparse arrays in frames', () => {
    const frames = new Array(3);
    frames[0] = { timestamp: 1 };
    // indices 1 and 2 are empty
    const body = {
      frames,
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    // Empty slots fail validation (no timestamp property)
    expect(result.ok).toBe(false);
  });

  it('handles extremely negative timestamp', () => {
    const body = {
      frames: [{ timestamp: -9999999999999 }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Negative allowed
  });

  it('handles extremely positive timestamp', () => {
    const body = {
      frames: [{ timestamp: 9999999999999 }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles sub-millisecond precision timestamp', () => {
    const body = {
      frames: [{ timestamp: 123.456789 }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });
});

describe('validation.destructive - prototype pollution protection', () => {
  it('handles __proto__ in frame object', () => {
    const body = JSON.parse('{"frames":[{"timestamp":1,"__proto__":{"evil":true}}],"videoFrames":[]}');
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Should not be affected
  });

  it('handles constructor in frame object', () => {
    const body = {
      frames: [{ 
        timestamp: 1,
        constructor: { evil: true }
      }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles prototype in frame object', () => {
    const body = {
      frames: [{ 
        timestamp: 1,
        prototype: { evil: true }
      }],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles __defineGetter__ in frame', () => {
    const frame: Record<string, unknown> = { timestamp: 1 };
    // This won't actually set a getter due to modern JS protections
    frame.__defineGetter__ = () => {};
    
    const body = {
      frames: [frame],
      videoFrames: [],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });
});

describe('validation.destructive - malformed dataURLs', () => {
  it('handles dataURL without base64 prefix', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:image/jpeg,rawcontent',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Structure valid, content not validated
  });

  it('handles dataURL with invalid mime type', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:evil/script;base64,YWJj',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles dataURL with no comma', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:image/jpeg;base64',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles dataURL with only scheme', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });

  it('handles empty dataURL', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: '',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true); // Empty string is a string
  });

  it('handles dataURL with newlines', () => {
    const body = {
      frames: [{ timestamp: 1 }],
      videoFrames: [{
        dataUrl: 'data:image/jpeg;base64,abc\ndef\nghi',
        timestamp: 1,
      }],
    };
    const result = validateSignRecognizeRequestBody(body);
    expect(result.ok).toBe(true);
  });
});
