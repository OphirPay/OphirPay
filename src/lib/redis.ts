// SPDX-License-Identifier: MIT
/**
 * Shared Redis client module for caching, rate limiting, and distributed locking.
 * Supports graceful degradation when Redis is unconfigured or unreachable.
 */

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  quit?(): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
}

let redisInstance: RedisClient | null = null;
let redisUnavailable = false;
let connectingPromise: Promise<RedisClient | null> | null = null;

const CONNECT_TIMEOUT_MS = 2000;

/**
 * Obtain a shared Redis client instance.
 * Gracefully returns null if REDIS_URL is not configured or connection fails.
 */
export async function getRedisClient(): Promise<RedisClient | null> {
  if (redisInstance) return redisInstance;
  if (redisUnavailable) return null;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      redisUnavailable = true;
      return null;
    }

    try {
      const mod = await import("ioredis");
      const RedisClass = mod.Redis ?? (mod as any).default;
      const client = new RedisClass(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: CONNECT_TIMEOUT_MS,
      });

      client.on?.("error", () => {
        // Prevent uncaught error event from crashing the process
      });

      await client.connect?.();
      redisInstance = client;
      return redisInstance;
    } catch (err) {
      console.warn("[redis] Redis connection failed, falling back to local fallback:", err);
      redisUnavailable = true;
      return null;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

/**
 * For testing and mocking: inject a specific Redis client implementation.
 */
export function setRedisClient(client: RedisClient | null): void {
  redisInstance = client;
  redisUnavailable = false;
  connectingPromise = null;
}

/**
 * Reset Redis client state (e.g. between tests).
 */
export function resetRedisClient(): void {
  redisInstance = null;
  redisUnavailable = false;
  connectingPromise = null;
}

/**
 * Check if Redis is configured via environment variable.
 */
export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}
