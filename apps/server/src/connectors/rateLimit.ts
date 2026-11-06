/** Sliding-window limiter: at most `limit` calls per `windowMs` for each key. Pure, so it is easy to test. */
export function createRateLimiter(limit: number, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a call if allowed. Otherwise says how long until a slot frees up. */
    take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: Math.max(1, (recent[0] ?? now) + windowMs - now) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true };
    },
    /** Forgets a key (when its connection is removed). */
    forget(key: string) {
      hits.delete(key);
    },
  };
}
