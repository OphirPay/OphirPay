// SPDX-License-Identifier: MIT

import { getRedisRestConfig } from "@/lib/rate-limit";

export interface RedisHealthCheckResult {
  status: "ok" | "error" | "disabled";
  latencyMs: number | null;
}

/**
 * Validates Redis connectivity for health checks across both transport protocols:
 * 1. HTTP/REST endpoints (e.g. Upstash) sending Bearer tokens.
 * 2. TCP connections (redis://, rediss://) using ioredis.
 * 3. Returns "disabled" if no Redis configuration is present.
 */
export async function checkRedisHealth(
  timeoutMs = 3000,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<RedisHealthCheckResult> {
  const restConfig = getRedisRestConfig();

  // 1. HTTP/REST Redis (e.g. Upstash)
  if (restConfig) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = restConfig.url.replace(/\/+$/, "");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (restConfig.token) {
        headers["Authorization"] = `Bearer ${restConfig.token}`;
      }

      const res = await fetchImpl(`${endpoint}/ping`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (res.ok) {
        return { status: "ok", latencyMs: Date.now() - start };
      }
      return { status: "error", latencyMs: null };
    } catch {
      clearTimeout(timer);
      return { status: "error", latencyMs: null };
    }
  }

  // 2. TCP Redis (redis:// / rediss://)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && /^rediss?:\/\//i.test(redisUrl)) {
    const start = Date.now();
    try {
      const RedisModule = await import("ioredis");
      const client = new RedisModule.Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: timeoutMs,
        lazyConnect: true,
        enableOfflineQueue: false,
      });

      await client.connect();
      const pong = await client.ping();
      const latencyMs = Date.now() - start;

      try {
        await client.quit();
      } catch {
        client.disconnect();
      }

      if (pong === "PONG" || !!pong) {
        return { status: "ok", latencyMs };
      }
      return { status: "error", latencyMs: null };
    } catch {
      return { status: "error", latencyMs: null };
    }
  }

  // 3. Not configured
  return { status: "disabled", latencyMs: null };
}
