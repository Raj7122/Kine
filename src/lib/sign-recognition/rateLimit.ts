export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 30;

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

export function checkSlidingWindowRateLimit(
  key: string,
  options: { windowMs?: number; maxRequests?: number; now?: number } = {}
): RateLimitResult {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const now = options.now ?? Date.now();

  const entry = store.get(key) ?? { timestamps: [] };
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  const used = entry.timestamps.length;
  const remaining = Math.max(0, maxRequests - used);

  if (used >= maxRequests) {
    const oldest = entry.timestamps[0] ?? now;
    const resetMs = Math.max(0, oldest + windowMs - now);
    const retryAfterSeconds = Math.ceil(resetMs / 1000);
    store.set(key, entry);

    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetMs,
      retryAfterSeconds,
    };
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  const oldestAfter = entry.timestamps[0] ?? now;
  const resetMs = Math.max(0, oldestAfter + windowMs - now);

  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - entry.timestamps.length),
    resetMs,
  };
}

export function clearRateLimitStoreForTests() {
  store.clear();
}
