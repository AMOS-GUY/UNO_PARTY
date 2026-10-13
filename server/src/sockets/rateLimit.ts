/**
 * Per-socket token bucket rate limiter.
 * Default: 10 events/sec sustained, burst 20. sendReaction: 1/sec.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** Returns true and consumes a token if allowed. */
  tryConsume(cost = 1): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Buckets for one socket connection. */
export class SocketRateLimits {
  readonly general = new RateLimiter(20, 10);
  readonly reaction = new RateLimiter(1, 1);
}
