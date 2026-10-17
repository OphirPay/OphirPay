// SPDX-License-Identifier: MIT

/**
 * Redis-backed idempotency key locking and response caching (#1366).
 *
 * Flow for `POST /api/batches`:
 * 1. Acquire an atomic `SET idempotency:${key} <lock> NX EX 120` lease in Redis.
 * 2. If `SET NX` fails because the key already exists in Redis:
 *    - If the stored entry is `"IN_FLIGHT"`, return HTTP `409 Conflict` with
 *      `Retry-After: 5`.
 *    - If the stored entry is `"COMPLETED"`, replay the cached HTTP `201`
 *      response body with the `Idempotent-Replay: true` header.
 * 3. Once batch creation finishes, replace the lock entry with the completed
 *    response payload and a 24-hour (`86,400`s) TTL (`SET ... EX 86400`).
 * 4. If an error aborts batch creation before completion, release the lock via
 *    `DEL idempotency:${key}` so immediate retries can proceed.
 * 5. If Redis is unconfigured or unreachable at any step, degrade gracefully to
 *    database-only uniqueness constraints (`(userId, idempotencyKey)`).
 */

import { NextResponse } from "next/server";
import { ERROR_CODES } from "@/lib/error-codes";
import { jsonSafe } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getRedisClient, type RedisClient } from "@/lib/redis";

/** Prefix for all idempotency keys in Redis (#1366). */
export const IDEMPOTENCY_KEY_PREFIX = "idempotency:";

/** Atomic in-flight lock lease duration in seconds (120s, #1366). */
export const IDEMPOTENCY_LOCK_TTL_SECONDS = 120;

/** Completed response cache TTL in seconds (24 hours = 86,400s, #1366). */
export const IDEMPOTENCY_CACHE_TTL_SECONDS = 86_400;

/** `Retry-After` header value (in seconds) returned on 409 in-flight conflicts (#1366). */
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 5;

export interface IdempotencyLockEntry {
  state: "IN_FLIGHT";
  userId?: string;
  lockedAt: string;
}

export interface IdempotencyCompletedEntry<T = unknown> {
  state: "COMPLETED";
  userId?: string;
  statusCode: number;
  body: T;
  completedAt: string;
}

export type IdempotencyStoredEntry<T = unknown> =
  | IdempotencyLockEntry
  | IdempotencyCompletedEntry<T>;

export type IdempotencyAcquireResult<T = unknown> =
  | {
      status: "ACQUIRED";
      redisKey: string;
    }
  | {
      status: "IN_FLIGHT";
      redisKey: string;
      retryAfterSeconds: number;
    }
  | {
      status: "CACHED";
      redisKey: string;
      statusCode: number;
      body: T;
      completedAt: string;
    }
  | {
      status: "UNAVAILABLE";
      redisKey: string;
    };

/**
 * Format the canonical Redis key `idempotency:${key}` (#1366).
 */
export function buildIdempotencyRedisKey(key: string): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${key}`;
}

function parseStoredEntry<T = unknown>(
  raw: string | null
): IdempotencyStoredEntry<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as IdempotencyStoredEntry<T>;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.state === "IN_FLIGHT" || parsed.state === "COMPLETED")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to acquire an atomic `SET NX EX` lock on `idempotency:${key}` with a
 * 120-second lease.
 *
 * - Returns `ACQUIRED` when the lock was newly set.
 * - Returns `IN_FLIGHT` when another request holds the active lock.
 * - Returns `CACHED` when a completed batch response is already cached.
 * - Returns `UNAVAILABLE` if Redis is not configured or throws an error.
 */
export async function acquireIdempotencyLock<T = unknown>(
  key: string,
  userId?: string,
  lockTtlSeconds = IDEMPOTENCY_LOCK_TTL_SECONDS,
  clientOverride?: RedisClient | null
): Promise<IdempotencyAcquireResult<T>> {
  const redisKey = buildIdempotencyRedisKey(key);

  try {
    const redis =
      clientOverride !== undefined ? clientOverride : await getRedisClient();
    if (!redis) {
      return { status: "UNAVAILABLE", redisKey };
    }

    const lockEntry: IdempotencyLockEntry = {
      state: "IN_FLIGHT",
      ...(userId ? { userId } : {}),
      lockedAt: new Date().toISOString(),
    };

    const setResult = await redis.set(
      redisKey,
      JSON.stringify(lockEntry),
      "NX",
      "EX",
      lockTtlSeconds
    );

    if (setResult === "OK") {
      return { status: "ACQUIRED", redisKey };
    }

    // Key already existed in Redis — inspect whether it's an in-flight lock or
    // a completed 24-hour cached response.
    const existingRaw = await redis.get(redisKey);
    const existing = parseStoredEntry<T>(existingRaw);

    if (!existing) {
      // The key expired between SET NX and GET; try once more to acquire.
      const retrySet = await redis.set(
        redisKey,
        JSON.stringify(lockEntry),
        "NX",
        "EX",
        lockTtlSeconds
      );
      if (retrySet === "OK") {
        return { status: "ACQUIRED", redisKey };
      }
      return {
        status: "IN_FLIGHT",
        redisKey,
        retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS,
      };
    }

    // Guard against cross-tenant collisions if two different users send the
    // same idempotency key string: fall back to the DB `(userId, idempotencyKey)` scope.
    if (userId && existing.userId && existing.userId !== userId) {
      return { status: "UNAVAILABLE", redisKey };
    }

    if (existing.state === "COMPLETED") {
      return {
        status: "CACHED",
        redisKey,
        statusCode: existing.statusCode,
        body: existing.body,
        completedAt: existing.completedAt,
      };
    }

    return {
      status: "IN_FLIGHT",
      redisKey,
      retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS,
    };
  } catch (err) {
    logger.warn("Redis idempotency lock failed; falling back to database", {
      redisKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "UNAVAILABLE", redisKey };
  }
}

/**
 * Cache a completed batch response in Redis for 24 hours (`86,400`s) under
 * `idempotency:${key}`, replacing the 120-second in-flight lock.
 */
export async function cacheIdempotencyResponse<T = unknown>(
  key: string,
  payload: {
    statusCode?: number;
    body: T;
    userId?: string;
  },
  ttlSeconds = IDEMPOTENCY_CACHE_TTL_SECONDS,
  clientOverride?: RedisClient | null
): Promise<boolean> {
  const redisKey = buildIdempotencyRedisKey(key);

  try {
    const redis =
      clientOverride !== undefined ? clientOverride : await getRedisClient();
    if (!redis) {
      return false;
    }

    const completedEntry: IdempotencyCompletedEntry<T> = {
      state: "COMPLETED",
      ...(payload.userId ? { userId: payload.userId } : {}),
      statusCode: payload.statusCode ?? 201,
      body: jsonSafe(payload.body) as T,
      completedAt: new Date().toISOString(),
    };

    const res = await redis.set(
      redisKey,
      JSON.stringify(completedEntry),
      "EX",
      ttlSeconds
    );
    return res === "OK";
  } catch (err) {
    logger.warn("Failed to cache idempotency response in Redis", {
      redisKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Retrieve a cached completed idempotency response from Redis, if present.
 */
export async function getCachedIdempotencyResponse<T = unknown>(
  key: string,
  userId?: string,
  clientOverride?: RedisClient | null
): Promise<IdempotencyCompletedEntry<T> | null> {
  const redisKey = buildIdempotencyRedisKey(key);

  try {
    const redis =
      clientOverride !== undefined ? clientOverride : await getRedisClient();
    if (!redis) {
      return null;
    }

    const raw = await redis.get(redisKey);
    const parsed = parseStoredEntry<T>(raw);
    if (!parsed || parsed.state !== "COMPLETED") {
      return null;
    }
    if (userId && parsed.userId && parsed.userId !== userId) {
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn("Failed to read cached idempotency response from Redis", {
      redisKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Release an in-flight lock (`DEL idempotency:${key}`) when batch creation
 * fails before producing a cacheable result.
 */
export async function releaseIdempotencyLock(
  key: string,
  clientOverride?: RedisClient | null
): Promise<boolean> {
  const redisKey = buildIdempotencyRedisKey(key);

  try {
    const redis =
      clientOverride !== undefined ? clientOverride : await getRedisClient();
    if (!redis) {
      return false;
    }

    const deleted = await redis.del(redisKey);
    return deleted > 0;
  } catch (err) {
    logger.warn("Failed to release Redis idempotency lock", {
      redisKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Build the HTTP 409 Conflict response with `Retry-After: 5` when a concurrent
 * request with the same idempotency key is still in flight (#1366).
 */
export function buildInFlightConflictResponse(
  retryAfterSeconds = IDEMPOTENCY_RETRY_AFTER_SECONDS
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message:
          "A batch creation request with this idempotency key is already in progress. Please retry after a few seconds.",
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
 * Build a replayed HTTP response from a cached Redis entry with the
 * `Idempotent-Replay: true` header (#1366).
 */
export function buildIdempotentReplayResponse<T>(cached: {
  statusCode: number;
  body: T;
}): NextResponse {
  return NextResponse.json(cached.body, {
    status: cached.statusCode,
    headers: {
      "Idempotent-Replay": "true",
    },
  });
}
