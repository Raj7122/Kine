import { describe, it, expect, beforeEach } from 'vitest';

import { checkSlidingWindowRateLimit, clearRateLimitStoreForTests } from './rateLimit';

describe('checkSlidingWindowRateLimit', () => {
  beforeEach(() => {
    clearRateLimitStoreForTests();
  });

  it('allows the first request and decrements remaining', () => {
    const result = checkSlidingWindowRateLimit('k', {
      windowMs: 1000,
      maxRequests: 2,
      now: 100,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(2);
    expect(result.remaining).toBe(1);
  });

  it('uses the default maxRequests when options are omitted', () => {
    const result = checkSlidingWindowRateLimit('default', { now: 0 });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(15);
    expect(result.remaining).toBe(14);
  });

  it('blocks when max requests are exceeded within the window', () => {
    const options = { windowMs: 1000, maxRequests: 2 };

    expect(checkSlidingWindowRateLimit('k', { ...options, now: 0 }).allowed).toBe(true);
    expect(checkSlidingWindowRateLimit('k', { ...options, now: 10 }).allowed).toBe(true);

    const blocked = checkSlidingWindowRateLimit('k', { ...options, now: 20 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets after the window passes', () => {
    const options = { windowMs: 1000, maxRequests: 1 };

    expect(checkSlidingWindowRateLimit('k', { ...options, now: 0 }).allowed).toBe(true);

    const blocked = checkSlidingWindowRateLimit('k', { ...options, now: 100 });
    expect(blocked.allowed).toBe(false);

    const allowedAfter = checkSlidingWindowRateLimit('k', { ...options, now: 2000 });
    expect(allowedAfter.allowed).toBe(true);
  });
});
