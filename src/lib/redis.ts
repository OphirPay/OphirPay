// SPDX-License-Identifier: MIT

/**
 * Shared Redis client and utilities.
 *
 * Provides a safe, graceful-fallback wrapper around Redis operations.
 * Node runtimes dynamically import `ioredis` if configured via `REDIS_URL`.
 * In environments where Redis is not configured or fails to connect,
 * operations gracefully fallback without crashing the process.
 */

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number | unknown>;
  expire(key: string, seconds: number): Promise<number | unknown>;
  ttl(key: string): Promise<number>;
  quit?(): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

const REDIS_CONNECT_TIMEOUT_MS = 2_000;

let redis: RedisClientLike | null = null;
let redisUnavailable = false;
let connecting: Promise<void> | null = null;

/**
 * Connect to Redis on first use.
 * Never throws: an unreachable or unconfigured Redis logs a warning and marks
 * Redis as unavailable, allowing callers to gracefully fall back.
 */
export async function getRedisClient(): Promise<RedisClientLike | null> {
  if (redis) return redis;
  if (redisUnavailable) return null;
  if (connecting) {
    await connecting;
    return redis;
  }

  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      redisUnavailable = true;
      return;
    }

    try {
      // Dynamic import — ioredis is optional in edge or lightweight dev environments
      const mod = await import("ioredis");
      const RedisConstructor = (mod as unknown as { Redis?: new (url: string, opts: unknown) => RedisClientLike; default?: new (url: string, opts: unknown) => RedisClientLike }).Redis ??
        (mod as unknown as { default?: new (url: string, opts: unknown) => RedisClientLike }).default;

      if (!RedisConstructor) {
        redisUnavailable = true;
        return;
      }

      const client = new RedisConstructor(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      });

      client.on?.("error", () => {});
      if (typeof (client as unknown as { connect: () => Promise<void> }).connect === "function") {
        await (client as unknown as { connect: () => Promise<void> }).connect();
      }

      redis = client;
    } catch (err) {
      redisUnavailable = true;
      console.warn("[redis] Redis connection failed — operations will fall back.", String(err));
    } finally {
      connecting = null;
    }
  })();

  await connecting;
  return redis;
}

/**
 * Execute a Redis operation with graceful fallback if Redis is unavailable or errors.
 */
export async function withRedis<T>(
  op: (client: RedisClientLike) => Promise<T>,
  fallback: T
): Promise<T> {
  const client = await getRedisClient();
  if (!client) return fallback;

  try {
    return await op(client);
  } catch (err) {
    console.warn("[redis] Operation failed, falling back to database default.", String(err));
    return fallback;
  }
}

/**
 * Check if Redis is actively configured in the current environment.
 */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL) && !redisUnavailable;
}

/**
 * Reset Redis client state for testing suites.
 */
export async function resetRedisForTesting(): Promise<void> {
  if (redis && typeof redis.quit === "function") {
    try {
      await redis.quit();
    } catch {
      // Ignore disconnect errors during teardown
    }
  }
  redis = null;
  redisUnavailable = false;
  connecting = null;
}

/**
 * Inject a mock Redis client for hermetic unit testing.
 */
export function setRedisClientForTesting(client: RedisClientLike | null): void {
  redis = client;
  redisUnavailable = client === null && !process.env.REDIS_URL;
  connecting = null;
}
