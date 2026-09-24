/**
 * Central cache abstraction used throughout the application.
 *
 * It prefers a Redis backend when `REDIS_URL` is defined, otherwise it falls
 * back to an in‑memory store so the application continues to work without a
 * Redis instance (e.g. during local development or CI).
 *
 * The API mirrors the subset of Redis commands we need: `GET`, `SET` with TTL,
 * `DEL` and a simple prefix‑based invalidation helper.
 *
 * All methods are async to keep the same signature regardless of the backend.
 */

import type { Redis } from 'ioredis';

// -----------------------------------------------------------------------------
// Backend selection
// -----------------------------------------------------------------------------
let redisClient: Redis | null = null;

if (process.env.REDIS_URL) {
  // Dynamically require ioredis so the package remains optional.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis') as typeof import('ioredis');
  redisClient = new IORedis(process.env.REDIS_URL);
}

// -----------------------------------------------------------------------------
// In‑memory fallback (simple TTL map)
// -----------------------------------------------------------------------------
type MemoryEntry = {
  value: string;
  expiresAt: number; // epoch ms
};

const memoryStore = new Map<string, MemoryEntry>();

// -----------------------------------------------------------------------------
// Helper utilities
// -----------------------------------------------------------------------------
function now(): number {
  return Date.now();
}

/**
 * Delete a list of keys from the in‑memory store.
 */
function deleteFromMemory(keys: string[]) {
  for (const key of keys) {
    memoryStore.delete(key);
  }
}

/**
 * Retrieve all keys that start with a given prefix from the in‑memory store.
 */
function keysWithPrefixFromMemory(prefix: string): string[] {
  const result: string[] = [];
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) result.push(key);
  }
  return result;
}

// -----------------------------------------------------------------------------
// Exported cache object
// -----------------------------------------------------------------------------
export const cache = {
  /**
   * Get a cached value. Returns `null` if the key does not exist or has expired.
   */
  async get(key: string): Promise<string | null> {
    if (redisClient) {
      return await redisClient.get(key);
    }

    const entry = memoryStore.get(key);
    if (!entry) return null;

    if (now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  },

  /**
   * Set a cached value with a TTL (in seconds).
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (redisClient) {
      await redisClient.set(key, value, 'EX', ttlSeconds);
      return;
    }

    const expiresAt = now() + ttlSeconds * 1000;
    memoryStore.set(key, { value, expiresAt });
  },

  /**
   * Delete a single key.
   */
  async del(key: string): Promise<void> {
    if (redisClient) {
      await redisClient.del(key);
      return;
    }
    memoryStore.delete(key);
  },

  /**
   * Invalidate every key that starts with the supplied prefix.
   *
   * This is used by mutation endpoints to purge stale read‑only responses.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    if (redisClient) {
      const keys = await redisClient.keys(`${prefix}*`);
      if (keys.length) {
        await redisClient.del(...keys);
      }
      return;
    }

    const keys = keysWithPrefixFromMemory(prefix);
    deleteFromMemory(keys);
  },
};
