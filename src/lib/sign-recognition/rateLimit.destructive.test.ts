import { describe, it, expect, beforeEach } from 'vitest';
import type { RateLimitResult } from './rateLimit';
import {
  checkSlidingWindowRateLimit,
  clearRateLimitStoreForTests,
} from './rateLimit';

/**
 * Destructive Tests for Rate Limiting
 * 
 * These tests stress the sliding window rate limiter with edge cases
 * designed to break the in-memory store implementation.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 15;

describe('rateLimit.destructive - time manipulation attacks', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('handles extremely negative timestamp', () => {
    const result = checkSlidingWindowRateLimit('test-key', {
      now: -9999999999999,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(DEFAULT_MAX_REQUESTS - 1);
  });

  it('handles extremely positive timestamp (year 3000)', () => {
    const result = checkSlidingWindowRateLimit('test-key', {
      now: 32503680000000,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles timestamp at year 2038 boundary (Unix epoch overflow)', () => {
    const y2038 = 2147483647000; // Jan 19, 2038
    const result = checkSlidingWindowRateLimit('test-key', {
      now: y2038,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles timestamp of zero (Unix epoch start)', () => {
    const result = checkSlidingWindowRateLimit('test-key', {
      now: 0,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles microsecond precision timestamps', () => {
    const result = checkSlidingWindowRateLimit('test-key', {
      now: 123456789.123456,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles windowMs of zero (immediate expiry)', () => {
    // With zero window, requests should immediately expire
    const key = 'zero-window';
    
    // First request at t=0
    const r1 = checkSlidingWindowRateLimit(key, { windowMs: 0, now: 0 });
    expect(r1.allowed).toBe(true);
    
    // Second request at t=1 - first should be expired
    const r2 = checkSlidingWindowRateLimit(key, { windowMs: 0, now: 1 });
    expect(r2.allowed).toBe(true);
  });

  it('handles extremely short windowMs (1ms)', () => {
    const key = 'short-window';
    const now = 1000;
    
    const r1 = checkSlidingWindowRateLimit(key, { windowMs: 1, now });
    expect(r1.allowed).toBe(true);
    
    // Same millisecond - should still count
    const r2 = checkSlidingWindowRateLimit(key, { windowMs: 1, now });
    expect(r2.allowed).toBe(true);
    
    // Next millisecond - first should be expired
    const r3 = checkSlidingWindowRateLimit(key, { windowMs: 1, now: now + 1 });
    expect(r3.allowed).toBe(true);
  });

  it('handles extremely long windowMs (1 year)', () => {
    const result = checkSlidingWindowRateLimit('test-key', {
      windowMs: 365 * 24 * 60 * 60 * 1000,
      now: 1000,
    });
    expect(result.allowed).toBe(true);
  });

  it('handles clock going backwards (time travel)', () => {
    const key = 'time-travel';
    
    // Request at t=1000
    checkSlidingWindowRateLimit(key, { now: 1000 });
    
    // Request at t=500 (clock went backwards)
    const result = checkSlidingWindowRateLimit(key, { now: 500 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(DEFAULT_MAX_REQUESTS - 2);
    
    // Third check - should have 2 used, so remaining is DEFAULT_MAX_REQUESTS - 3
    const state = checkSlidingWindowRateLimit(key, { now: 1000 });
    expect(state.remaining).toBe(DEFAULT_MAX_REQUESTS - 3);
  });

  it('handles rapid time jumps forward', () => {
    const key = 'time-jump';
    
    // Fill up the limit
    for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
      checkSlidingWindowRateLimit(key, { now: i * 1000 });
    }
    
    // At limit
    const atLimit = checkSlidingWindowRateLimit(key, { now: DEFAULT_MAX_REQUESTS * 1000 });
    expect(atLimit.allowed).toBe(false);
    
    // Jump forward past window - should reset
    const afterJump = checkSlidingWindowRateLimit(key, {
      now: DEFAULT_MAX_REQUESTS * 1000 + DEFAULT_WINDOW_MS + 1,
    });
    expect(afterJump.allowed).toBe(true);
  });
});

describe('rateLimit.destructive - concurrent request simulation', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('handles 100 simultaneous requests with same key', () => {
    const key = 'concurrent';
    const now = 1000;
    const results: RateLimitResult[] = [];
    
    // Simulate 100 concurrent requests
    for (let i = 0; i < 100; i++) {
      results.push(checkSlidingWindowRateLimit(key, { now }));
    }
    
    const allowed = results.filter(r => r.allowed).length;
    const rejected = results.filter(r => !r.allowed).length;
    
    // Should allow exactly maxRequests
    expect(allowed).toBe(DEFAULT_MAX_REQUESTS);
    expect(rejected).toBe(100 - DEFAULT_MAX_REQUESTS);
  });

  it('handles interleaved requests from multiple keys', () => {
    const keys = Array.from({ length: 100 }, (_, i) => `key-${i}`);
    const now = 1000;
    
    // Each key gets 15 requests
    keys.forEach(key => {
      for (let i = 0; i < 20; i++) {
        const result = checkSlidingWindowRateLimit(key, { now });
        if (i < DEFAULT_MAX_REQUESTS) {
          expect(result.allowed).toBe(true);
        } else {
          expect(result.allowed).toBe(false);
        }
      }
    });
  });

  it('handles key exhaustion (1000 unique keys)', () => {
    const now = 1000;
    
    // Create many unique keys
    for (let i = 0; i < 1000; i++) {
      const key = `unique-key-${i}-${Math.random()}`;
      const result = checkSlidingWindowRateLimit(key, { now });
      expect(result.allowed).toBe(true);
    }
    
    // Verify the Map handles many entries by checking a fresh key still works
    const newKey = `fresh-key-${Date.now()}`;
    const result = checkSlidingWindowRateLimit(newKey, { now: now + 1 });
    expect(result.allowed).toBe(true);
  });

  it('handles rapid sequential requests at boundary', () => {
    const key = 'boundary-test';
    const windowMs = 1000;
    
    // Requests exactly at window boundary
    for (let i = 0; i < 50; i++) {
      const now = i * windowMs; // Each request at exact window boundary
      const result = checkSlidingWindowRateLimit(key, { windowMs, now });
      
      // Should always be allowed because previous request is exactly at cutoff
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(DEFAULT_MAX_REQUESTS - 1);
    }
  });

  it('handles requests at exact millisecond within window', () => {
    const key = 'precision';
    const windowMs = 100;
    const startTime = 1000;
    
    // Fill up exactly to limit
    for (let i = 0; i < DEFAULT_MAX_REQUESTS; i++) {
      const result = checkSlidingWindowRateLimit(key, {
        windowMs,
        now: startTime + i, // Each 1ms apart
      });
      expect(result.allowed).toBe(true);
    }
    
    // Next request should be blocked
    const blocked = checkSlidingWindowRateLimit(key, {
      windowMs,
      now: startTime + DEFAULT_MAX_REQUESTS,
    });
    expect(blocked.allowed).toBe(false);
    
    // Wait until first request expires
    const unblocked = checkSlidingWindowRateLimit(key, {
      windowMs,
      now: startTime + windowMs + 1,
    });
    expect(unblocked.allowed).toBe(true);
  });
});

describe('rateLimit.destructive - key edge cases', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('handles empty string key', () => {
    const result = checkSlidingWindowRateLimit('', { now: 1000 });
    expect(result.allowed).toBe(true);
  });

  it('handles extremely long key (10KB)', () => {
    const longKey = 'a'.repeat(10_000);
    const result = checkSlidingWindowRateLimit(longKey, { now: 1000 });
    expect(result.allowed).toBe(true);
  });

  it('handles key with special characters', () => {
    const specialKeys = [
      'key\x00with\x01null',
      'key\nwith\nnewlines',
      'key\twith\ttabs',
      'key with spaces',
      '🎉emoji-key🎊',
      '<script>alert(1)</script>',
      "'; DROP TABLE users; --",
      '../../etc/passwd',
      'key\u200B\u200C\u200D', // Zero-width chars
    ];
    
    specialKeys.forEach(key => {
      const result = checkSlidingWindowRateLimit(key, { now: 1000 });
      expect(result.allowed).toBe(true);
    });
  });

  it('handles key that looks like prototype property', () => {
    const protoKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];
    
    protoKeys.forEach(key => {
      const result = checkSlidingWindowRateLimit(key, { now: 1000 });
      expect(result.allowed).toBe(true);
      
      // Should be tracked independently
      const result2 = checkSlidingWindowRateLimit(key, { now: 1001 });
      expect(result2.remaining).toBe(DEFAULT_MAX_REQUESTS - 2);
    });
  });

  it('handles unicode normalization edge cases', () => {
    // Different representations of same character
    const key1 = 'café'; // é as single char
    const key2 = 'caf\u0065\u0301'; // e + combining acute
    
    const r1 = checkSlidingWindowRateLimit(key1, { now: 1000 });
    const r2 = checkSlidingWindowRateLimit(key2, { now: 1000 });
    
    // Should be treated as different keys (raw string comparison)
    expect(r1.allowed && r2.allowed).toBe(true);
  });

  it('handles key with only whitespace', () => {
    const wsKeys = ['   ', '\t', '\n', '\r\n', ' \t\n '];
    
    wsKeys.forEach(key => {
      const result = checkSlidingWindowRateLimit(key, { now: 1000 });
      expect(result.allowed).toBe(true);
    });
  });
});

describe('rateLimit.destructive - limit boundary conditions', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('handles maxRequests of 1 (strictest limit)', () => {
    const key = 'strict';
    
    const r1 = checkSlidingWindowRateLimit(key, { maxRequests: 1, now: 1000 });
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(0);
    
    const r2 = checkSlidingWindowRateLimit(key, { maxRequests: 1, now: 1000 });
    expect(r2.allowed).toBe(false);
    expect(r2.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('handles maxRequests of 0 (always blocked)', () => {
    const key = 'blocked';
    
    const r1 = checkSlidingWindowRateLimit(key, { maxRequests: 0, now: 1000 });
    expect(r1.allowed).toBe(false);
    expect(r1.remaining).toBe(0);
    
    // Even with time passing, should remain blocked
    const r2 = checkSlidingWindowRateLimit(key, { maxRequests: 0, now: 999999999 });
    expect(r2.allowed).toBe(false);
  });

  it('handles extremely high maxRequests (10000)', () => {
    const key = 'permissive';
    
    for (let i = 0; i < 100; i++) {
      const result = checkSlidingWindowRateLimit(key, { maxRequests: 10000, now: 1000 + i });
      expect(result.allowed).toBe(true);
    }
  });

  it('handles exact boundary - maxRequests requests exactly', () => {
    const key = 'exact';
    const maxRequests = 5;
    
    // Make exactly maxRequests requests
    for (let i = 0; i < maxRequests; i++) {
      const result = checkSlidingWindowRateLimit(key, { maxRequests, now: 1000 });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(maxRequests - i - 1);
    }
    
    // Next request should be blocked
    const blocked = checkSlidingWindowRateLimit(key, { maxRequests, now: 1000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('handles remaining count accuracy with time progression', () => {
    const key = 'remaining-test';
    const windowMs = 1000;
    const maxRequests = 5;
    
    // 3 requests at t=0, 100, 200
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 0 });
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 100 });
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 200 });
    
    // At t=500, all 3 still in window, plus this check makes 4 used
    const mid = checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 500 });
    expect(mid.remaining).toBe(1); // 5 - 4 = 1 remaining
    
    // At t=1100, cutoff=100. Filter is t > cutoff, so:
    //   t=0 expired (0 > 100 false)
    //   t=100 expired (100 > 100 false)
    //   t=200 kept, t=500 kept = 2 in window
    // This call adds t=1100 = 3 used, remaining = 5 - 3 = 2
    const afterExpiry = checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 1100 });
    expect(afterExpiry.remaining).toBe(2);
  });
});

describe('rateLimit.destructive - retryAfter calculation', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('calculates correct retryAfter for single expired request', () => {
    const key = 'retry-test';
    const windowMs = 1000;
    
    // Request at t=0
    checkSlidingWindowRateLimit(key, { windowMs, now: 0 });
    
    // Fill to limit
    for (let i = 1; i < DEFAULT_MAX_REQUESTS; i++) {
      checkSlidingWindowRateLimit(key, { windowMs, now: i * 10 });
    }
    
    // Next request blocked at t=100
    const blocked = checkSlidingWindowRateLimit(key, { windowMs, now: 100 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Should be approximately (0 + 1000 - 100) / 1000 = 0.9s, rounded up to 1s
    expect(blocked.retryAfterSeconds).toBe(1);
  });

  it('handles retryAfter when multiple requests need to expire', () => {
    const key = 'multi-retry';
    const windowMs = 1000;
    const maxRequests = 3;
    
    // 3 requests at t=0, 100, 200
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 0 });
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 100 });
    checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 200 });
    
    // At t=250, need to wait for oldest (t=0) to expire
    const blocked = checkSlidingWindowRateLimit(key, { maxRequests, windowMs, now: 250 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1); // (0 + 1000 - 250) = 750ms -> ceil = 1s
  });

  it('handles zero retryAfter when at exact expiry boundary', () => {
    const key = 'zero-retry';
    const windowMs = 1000;
    
    // Request at t=0
    checkSlidingWindowRateLimit(key, { windowMs, now: 0 });
    
    // Fill to limit
    for (let i = 1; i < DEFAULT_MAX_REQUESTS; i++) {
      checkSlidingWindowRateLimit(key, { windowMs, now: 1 });
    }
    
    // At exact expiry of first request
    const blocked = checkSlidingWindowRateLimit(key, { windowMs, now: 1000 });
    // At t=1000, cutoff is 0, so request at t=0 is NOT included (> cutoff)
    // This means we should have room
    expect(blocked.allowed).toBe(true);
  });
});

describe('rateLimit.destructive - store cleanup behavior', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('cleans up expired entries on new request', () => {
    const key = 'cleanup';
    const windowMs = 1000;
    
    // Many requests at start
    for (let i = 0; i < 100; i++) {
      checkSlidingWindowRateLimit(key, { windowMs, now: i });
    }
    
    // Long time passes - all expired
    const result = checkSlidingWindowRateLimit(key, { windowMs, now: 10000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(DEFAULT_MAX_REQUESTS - 1);
    // Internal: expired timestamps should be filtered out
  });

  it('maintains correct state across time jumps', () => {
    const key = 'stateful';
    const windowMs = 5000;
    
    // Request at t=0
    checkSlidingWindowRateLimit(key, { windowMs, now: 0 });
    
    // Jump to t=10000 (way past window)
    const r2 = checkSlidingWindowRateLimit(key, { windowMs, now: 10000 });
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(DEFAULT_MAX_REQUESTS - 1);
    
    // Jump back (time travel) - should still work
    const r3 = checkSlidingWindowRateLimit(key, { windowMs, now: 5000 });
    expect(r3.allowed).toBe(true);
  });
});
