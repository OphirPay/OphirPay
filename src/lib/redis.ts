// SPDX-License-Identifier: MIT

/**
 * @file redis.ts
 * Centralized Redis client connection and lifecycle management for OphirPay.
 * Provides unified connection acquisition, graceful teardown via quit(),
 * and integration with centralized lifecycle shutdown hooks.
 */

import { registerShutdownHook } from "./lifecycle";

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
  disconnect?(): void;
  status?: string;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

let activeRedisClient: RedisClientLike | null = null;
let isConnecting = false;
let redisUnavailable = false;

const REDIS_CONNECT_TIMEOUT_MS = 2_000;
const REDIS_QUIT_TIMEOUT_MS = 3_000;

/**
 * Returns the currently active Redis client, or null if none is connected.
 */
export function getActiveRedisClient(): RedisClientLike | null {
  return activeRedisClient;
}

/**
 * Check if an active Redis client exists and is connected.
 */
export function hasActiveRedisClient(): boolean {
  return activeRedisClient !== null && !redisUnavailable;
}

/**
 * Obtain a shared Redis client instance.
 * Dynamically imports `ioredis` so that environments without TCP Redis
 * or edge runtimes degrade gracefully to in-memory fallbacks without failing.
 */
export async function getRedisClient(): Promise<RedisClientLike | null> {
  if (activeRedisClient) {
    return activeRedisClient;
  }

  if (redisUnavailable || isConnecting) {
    return null;
  }

  const url = process.env.REDIS_URL;
  if (!url || !/^rediss?:\/\//i.test(url)) {
    return null;
  }

  isConnecting = true;

  try {
    const mod = await import("ioredis");
    const RedisConstructor = (mod as unknown as { default?: new (url: string, opts?: unknown) => RedisClientLike; Redis?: new (url: string, opts?: unknown) => RedisClientLike }).Redis ??
      (mod as unknown as { default: new (url: string, opts?: unknown) => RedisClientLike }).default;

    if (!RedisConstructor) {
      redisUnavailable = true;
      return null;
    }

    const client = new RedisConstructor(url, {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      enableOfflineQueue: false,
    });

    // Handle background error events to prevent unhandled node crash
    if (typeof client.on === "function") {
      client.on("error", (err: unknown) => {
        console.warn("[redis] Background error on client:", err);
      });
    }

    activeRedisClient = client;
    return activeRedisClient;
  } catch (err) {
    console.warn("[redis] Failed to initialize Redis client, falling back to in-memory:", err);
    redisUnavailable = true;
    return null;
  } finally {
    isConnecting = false;
  }
}

/**
 * Gracefully disconnect the Redis client with quit() and timeout fallback.
 */
export async function disconnectRedis(): Promise<void> {
  if (!activeRedisClient) {
    return;
  }

  const client = activeRedisClient;
  activeRedisClient = null;

  console.log(
    JSON.stringify({
      level: "info",
      event: "redis:teardown:start",
      timestamp: new Date().toISOString(),
      message: "[redis] Disconnecting active Redis client...",
    })
  );

  try {
    // Attempt quit() with timeout protection
    await Promise.race([
      client.quit(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Redis quit timed out after ${REDIS_QUIT_TIMEOUT_MS}ms`)),
          REDIS_QUIT_TIMEOUT_MS
        )
      ),
    ]);

    console.log(
      JSON.stringify({
        level: "info",
        event: "redis:teardown:complete",
        timestamp: new Date().toISOString(),
        message: "[redis] Redis client cleanly disconnected via quit().",
      })
    );
  } catch (err) {
    console.warn("[redis] Graceful quit failed or timed out, forcing disconnect:", err);
    try {
      if (typeof client.disconnect === "function") {
        client.disconnect();
      }
    } catch {
      // Ignore forced disconnect errors
    }
  }
}

/**
 * Test helper to reset internal client state or inject a mock client.
 */
export function setRedisClientForTesting(client: RedisClientLike | null): void {
  activeRedisClient = client;
  redisUnavailable = false;
  isConnecting = false;
}

// Register Redis disconnect as a shutdown hook (priority 5: after app routes stop, alongside DB)
registerShutdownHook("redis", disconnectRedis, 5);
