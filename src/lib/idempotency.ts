// SPDX-License-Identifier: MIT
/**
 * Redis-backed distributed idempotency locking and response caching.
 *
 * Implements an atomic SET NX EX lease on in-flight requests and caches
 * completed responses for 24 hours to serve consistent idempotent re-submissions.
 */

import { getRedisClient, type RedisClient } from "@/lib/redis";
import { NextResponse } from "next/server";
import { ERROR_CODES } from "@/lib/error-codes";

export const IDEMPOTENCY_LOCK_LEASE_SECONDS = 120; // 120-second lease
export const IDEMPOTENCY_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours (86,400s)
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 5; // 5-second backoff
export const IDEMPOTENCY_PREFIX = "idempotency:";

export interface IdempotencyLockState {
  status: "IN_PROGRESS" | "COMPLETED";
  createdAt: number;
  body?: any;
  statusCode?: number;
  headers?: Record<string, string>;
}

export type LockAcquisitionResult =
  | { status: "ACQUIRED"; lockKey: string }
  | { status: "IN_PROGRESS"; retryAfter: number }
  | { status: "COMPLETED"; cachedResponse: { body: any; statusCode: number; headers?: Record<string, string> } }
  | { status: "BYPASS" };

export function formatIdempotencyKey(key: string): string {
  return `${IDEMPOTENCY_PREFIX}${key}`;
}

/**
 * Attempt to acquire an atomic idempotency lock in Redis.
 *
 * 1. Checks if a previous execution has completed and is cached (TTL 24h).
 * 2. If an in-flight request already holds the lock, returns IN_PROGRESS.
 * 3. Uses atomic `SET NX EX 120` to guarantee single execution.
 * 4. Gracefully degrades to BYPASS if Redis is down or unconfigured.
 */
export async function acquireIdempotencyLock(
  key: string,
  clientOverride?: RedisClient | null
): Promise<LockAcquisitionResult> {
  const redis = clientOverride !== undefined ? clientOverride : await getRedisClient();
  if (!redis) {
    return { status: "BYPASS" };
  }

  const redisKey = formatIdempotencyKey(key);

  try {
    // 1. Check existing state
    const existingRaw = await redis.get(redisKey);
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw) as IdempotencyLockState;
        if (parsed.status === "COMPLETED") {
          return {
            status: "COMPLETED",
            cachedResponse: {
              body: parsed.body,
              statusCode: parsed.statusCode ?? 201,
              headers: parsed.headers,
            },
          };
        }
        if (parsed.status === "IN_PROGRESS" || existingRaw === "IN_PROGRESS") {
          return {
            status: "IN_PROGRESS",
            retryAfter: IDEMPOTENCY_RETRY_AFTER_SECONDS,
          };
        }
      } catch {
        // Plain string fallback
        if (existingRaw === "IN_PROGRESS") {
          return {
            status: "IN_PROGRESS",
            retryAfter: IDEMPOTENCY_RETRY_AFTER_SECONDS,
          };
        }
      }
    }

    // 2. Atomic SET NX EX 120
    const inProgressPayload = JSON.stringify({
      status: "IN_PROGRESS",
      createdAt: Date.now(),
    });

    const setRes = await redis.set(
      redisKey,
      inProgressPayload,
      "EX",
      IDEMPOTENCY_LOCK_LEASE_SECONDS,
      "NX"
    );

    if (setRes === "OK" || setRes === true) {
      return { status: "ACQUIRED", lockKey: redisKey };
    }

    // Failed to acquire lock — concurrent request won the race
    return {
      status: "IN_PROGRESS",
      retryAfter: IDEMPOTENCY_RETRY_AFTER_SECONDS,
    };
  } catch (err) {
    console.warn("[idempotency] Redis error during lock acquisition — falling back to database constraints:", err);
    return { status: "BYPASS" };
  }
}

/**
 * Save a completed response in Redis with a 24-hour TTL.
 */
export async function saveIdempotentResponse(
  key: string,
  data: { body: any; statusCode?: number; headers?: Record<string, string> },
  ttlSeconds = IDEMPOTENCY_CACHE_TTL_SECONDS,
  clientOverride?: RedisClient | null
): Promise<void> {
  const redis = clientOverride !== undefined ? clientOverride : await getRedisClient();
  if (!redis) return;

  const redisKey = formatIdempotencyKey(key);
  try {
    const payload: IdempotencyLockState = {
      status: "COMPLETED",
      createdAt: Date.now(),
      body: data.body,
      statusCode: data.statusCode ?? 201,
      headers: data.headers,
    };
    await redis.set(redisKey, JSON.stringify(payload), "EX", ttlSeconds);
  } catch (err) {
    console.warn("[idempotency] Failed to cache idempotent response in Redis:", err);
  }
}

/**
 * Release an acquired in-flight lock (used when an error occurs before completion).
 */
export async function releaseIdempotencyLock(
  key: string,
  clientOverride?: RedisClient | null
): Promise<void> {
  const redis = clientOverride !== undefined ? clientOverride : await getRedisClient();
  if (!redis) return;

  const redisKey = formatIdempotencyKey(key);
  try {
    await redis.del(redisKey);
  } catch (err) {
    console.warn("[idempotency] Failed to release idempotency lock:", err);
  }
}

/**
 * Generate HTTP 409 Conflict with Retry-After: 5 header for in-flight requests.
 */
export function makeIdempotencyConflictResponse(
  retryAfterSeconds = IDEMPOTENCY_RETRY_AFTER_SECONDS,
  message = "An in-flight request is already processing with this idempotency key. Please retry shortly."
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 409,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

/**
 * Generate HTTP response from cached completed idempotent response.
 */
export function makeIdempotentReplayResponse(
  cached: { body: any; statusCode: number; headers?: Record<string, string> }
): NextResponse {
  const headers = new Headers(cached.headers || {});
  headers.set("Idempotent-Replay", "true");

  return NextResponse.json(cached.body, {
    status: cached.statusCode ?? 201,
    headers,
  });
}
