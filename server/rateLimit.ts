// server/rateLimit.ts
// Simple in-memory rate limits (per server process) against password
// guessing, sign-up spam and save flooding. Behind several server
// instances, move these counters to a shared store such as Redis.

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
    setInterval(() => this.sweep(), windowMs).unref();
  }

  /** Counts a hit for `key`; returns how many seconds to wait if it's over the limit, else 0. */
  hit(key: string): number {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count > this.limit ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
  }

  /** Seconds left on a block for `key` without counting a hit (0 = not blocked). */
  blockedFor(key: string): number {
    const bucket = this.buckets.get(key);
    const now = Date.now();
    return bucket && bucket.resetAt > now && bucket.count >= this.limit ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
