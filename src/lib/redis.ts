// SPDX-License-Identifier: MIT
/**
 * Shared Redis client registry and graceful teardown helper (Issue #1311).
 *
 * Centralizes lifecycle tracking for TCP (`ioredis`) Redis clients so that
 * `SIGTERM` / `SIGINT` shutdown handlers can cleanly invoke `await redis.quit()`
 * without leaking sockets or leaving half-open connections.
 */

export interface RedisClientLike {
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
  status?: string;
}

const globalForRedis = globalThis as unknown as {
  __ophirpayRedisClients?: Set<RedisClientLike>;
  __ophirpaySharedRedis?: RedisClientLike | null;
};

function getClientSet(): Set<RedisClientLike> {
  if (!globalForRedis.__ophirpayRedisClients) {
    globalForRedis.__ophirpayRedisClients = new Set<RedisClientLike>();
  }
  return globalForRedis.__ophirpayRedisClients;
}

/**
 * Register a Redis client instance for graceful teardown on process shutdown.
 */
export function registerRedisClient<T extends RedisClientLike>(client: T): T {
  if (client && typeof client === "object") {
    getClientSet().add(client);
    globalForRedis.__ophirpaySharedRedis = client;
  }
  return client;
}

/**
 * Return the currently registered shared Redis client, or lazily instantiate
 * an `ioredis` client when `REDIS_URL` is a `redis://` or `rediss://` URL.
 */
export async function getRedisClient(): Promise<RedisClientLike | null> {
  if (globalForRedis.__ophirpaySharedRedis) {
    return globalForRedis.__ophirpaySharedRedis;
  }

  const url = process.env.REDIS_URL;
  if (!url || !/^rediss?:\/\//i.test(url)) {
    return null;
  }

  try {
    const mod = await import("ioredis");
    const RedisCtor = mod.default ?? mod.Redis;
    const client = new RedisCtor(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    client.on("error", () => {
      // Handled at call sites; prevent unhandled error event crashes.
    });
    await client.connect();
    return registerRedisClient(client);
  } catch {
    return null;
  }
}

/**
 * Gracefully close all registered Redis clients via `await redis.quit()`,
 * falling back to `redis.disconnect()` if `quit()` rejects.
 */
export async function disconnectRedisClients(): Promise<number> {
  const clients = Array.from(getClientSet());
  getClientSet().clear();
  globalForRedis.__ophirpaySharedRedis = null;

  let closed = 0;
  for (const client of clients) {
    try {
      if (typeof client.quit === "function") {
        await client.quit();
        closed += 1;
      } else if (typeof client.disconnect === "function") {
        client.disconnect();
        closed += 1;
      }
    } catch {
      try {
        client.disconnect?.();
      } catch {
        // Ignore secondary disconnect errors during teardown
      }
    }
  }
  return closed;
}

export function getRegisteredRedisClientCount(): number {
  return getClientSet().size;
}

export function resetRedisClientsForTests(): void {
  getClientSet().clear();
  globalForRedis.__ophirpaySharedRedis = null;
}
