// SPDX-License-Identifier: MIT

/**
 * Consolidated rate-limit store with pluggable backends.
 *
 * • In-memory (dev / single instance)
 * • Redis      (production / multi-instance via REDIS_URL env)
 *
 * The store is lazily initialised on first use.  Set REDIS_URL to opt into
 * the Redis backend; otherwise the in-memory store is used.
 */

// ── Interface ──────────────────────────────────────────────────

export interface RateLimitResult {
  /** Whether this request is within the limit */
  allowed: boolean;
  /** How many requests remain in the current window */
  remaining: number;
  /** Unix-ms timestamp when the window resets */
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Increment the counter for `key` and return the current state.
   *
   * @param key        Unique identifier (e.g. IP address)
   * @param windowMs   Sliding-window duration in milliseconds
   * @param maxRequests  Maximum allowed requests in the window
   */
  increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult>;

  /** Reset the counter for `key` (e.g. on auth success). */
  reset(key: string): Promise<void>;
}

/**
 * Seconds (rounded up) until the current window resets.
 *
 * Used to populate the `Retry-After` header on 429 responses so clients can
 * back off correctly. Never returns a negative value.
 */
export function getRetryAfterSeconds(result: RateLimitResult): number {
  return Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
}

// ── In-Memory Store ────────────────────────────────────────────

export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetAt: number }>();

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
    }

    entry.count++;
    this.store.set(key, entry);

    // Periodic cleanup — prevent unbounded memory growth under abuse
    if (this.store.size > 10_000) {
      for (const [k, v] of this.store) {
        if (v.resetAt < now) this.store.delete(k);
      }
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    return { allowed: entry.count <= maxRequests, remaining, resetAt: entry.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ── Redis Store ────────────────────────────────────────────────

export class RedisRateLimitStore implements RateLimitStore {
  // Lightweight Redis client interface — works with ioredis, node-redis, or Upstash
  constructor(
    private redis: {
      incr: (key: string) => Promise<number>;
      expire: (key: string, seconds: number) => Promise<unknown>;
      del: (key: string) => Promise<unknown>;
    }
  ) {}

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const ttl = Math.ceil(windowMs / 1000);

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttl);
    }

    const remaining = Math.max(0, maxRequests - count);
    return { allowed: count <= maxRequests, remaining, resetAt: now + windowMs };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

// ── Singleton Lifecycle ────────────────────────────────────────

let _store: RateLimitStore | null = null;

/** Return the current rate-limit store (lazy-inits in-memory if never configured). */
export function getRateLimitStore(): RateLimitStore {
  if (!_store) {
    _store = new InMemoryRateLimitStore();
  }
  return _store;
}

/** Replace the store at runtime (call during app bootstrap). */
export function setRateLimitStore(store: RateLimitStore): void {
  _store = store;
}

/**
 * Initialise the rate-limit store.
 *
 * When REDIS_URL is set this attempts to connect to Redis; on failure it
 * falls back to the in-memory store and logs a warning so the app stays up.
 *
 * Call once during startup (e.g. from instrumentation.ts or a top-level layout).
 */
export async function initRateLimitStore(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Dynamic import — ioredis is an optional peer dependency.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RedisModule: any = await import("ioredis");
      const redis = new RedisModule.Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await redis.connect();
      _store = new RedisRateLimitStore(redis);
      console.log("[rate-limit] Using Redis backend");
    } catch (err) {
      console.warn(
        "[rate-limit] Redis unavailable — falling back to in-memory store.",
        String(err)
      );
      _store = new InMemoryRateLimitStore();
    }
  } else {
    _store = new InMemoryRateLimitStore();
  }
}
