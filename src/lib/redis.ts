// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";

interface RedisInstance {
  quit: () => Promise<unknown>;
  disconnect?: () => void;
  status?: string;
}

let redisClient: RedisInstance | null = null;

/**
 * Returns the active Redis client or creates one if configured via REDIS_URL.
 * Uses dynamic import for ioredis so Edge environments or setups without Redis
 * remain completely functional.
 */
export async function getRedisClient(): Promise<RedisInstance | null> {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || (!redisUrl.startsWith("redis://") && !redisUrl.startsWith("rediss://"))) {
    return null;
  }

  try {
    const RedisModule = await import("ioredis");
    const client = new RedisModule.Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    await client.connect();
    redisClient = client as unknown as RedisInstance;
    return redisClient;
  } catch (err) {
    logger.warn("[Redis] Failed to establish Redis connection", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Set an explicit Redis client instance (useful in tests or custom bootstrapping).
 */
export function setRedisClient(client: RedisInstance | null): void {
  redisClient = client;
}

/**
 * Gracefully disconnect the Redis client if active.
 */
export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;

  const client = redisClient;
  redisClient = null;

  try {
    await client.quit();
    logger.info("[Redis] Redis client disconnected gracefully");
  } catch (err) {
    logger.error("[Redis] Error disconnecting Redis client", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Force disconnect if quit timed out or threw
    try {
      client.disconnect?.();
    } catch {
      // Ignore fallback disconnect errors
    }
  }
}
