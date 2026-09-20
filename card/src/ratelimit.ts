export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Options {
  /** Requests allowed per window per key. */
  limit: number;
  windowMs: number;
  /** Injected clock. */
  now?: () => number;
  /** Upper bound on tracked keys, so an attacker cannot grow memory without limit. */
  maxKeys?: number;
}

/**
 * Sliding window limiter held in memory. Good for tests and a single instance.
 * Serverless functions run many instances, so production should back the same
 * `RateLimiter` interface with a shared store (for example Upstash Redis or
 * Vercel KV) or use the platform's own rate limiting in front of the endpoint.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: Options): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.delete(key); // re-insert so Map order tracks recency
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        // Drop the least recently seen key.
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return { ok: true };
    },
  };
}
