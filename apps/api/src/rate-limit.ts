interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxClients = 10_000,
  ) {}

  consume(key: string, now = Date.now()): RateLimitResult {
    for (const [client, value] of this.#buckets) {
      if (value.resetAt <= now) this.#buckets.delete(client);
    }
    if (!this.#buckets.has(key) && this.#buckets.size >= this.maxClients) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)),
      };
    }
    const existing = this.#buckets.get(key);
    const bucket =
      existing === undefined || existing.resetAt <= now
        ? { count: 0, resetAt: now + this.windowMs }
        : existing;

    bucket.count += 1;
    this.#buckets.set(key, bucket);

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    return {
      allowed: bucket.count <= this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      retryAfterSeconds,
    };
  }
}
