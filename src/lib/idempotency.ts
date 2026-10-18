// SPDX-License-Identifier: MIT

/**
 * Redis-backed Idempotency Lock and Cache Service (Issue #1366).
 *
 * Implements an atomic distributed lock on `idempotency:${key}` with a 120-second lease
 * to prevent duplicate batch creations during in-flight transaction simulation and assembly.
 * Completed batch payloads are cached for 24 hours to serve idempotent replays.
 * If Redis is unavailable or unconfigured, gracefully falls back to database uniqueness constraints.
 */

import { getRedisClient, isRedisConfigured } from "@/lib/redis";

export const IDEMPOTENCY_KEY_PREFIX = "idempotency:";
export const DEFAULT_LOCK_LEASE_SECONDS = 120; // 120-second lease for in-flight requests
export const DEFAULT_CACHE_TTL_SECONDS = 86400; // 24 hours retention for completed responses
export const DEFAULT_RETRY_AFTER_SECONDS = 5;

export interface IdempotentCachedResponse {
  data: unknown;
  status?: number;
  meta?: Record<string, unknown>;
}

export type IdempotencyLockResult =
  | { status: "acquired" }
  | { status: "in_flight"; retryAfter: number }
  | { status: "cached"; response: IdempotentCachedResponse }
  | { status: "fallback" };

interface InFlightPayload {
  status: "processing";
  startedAt: number;
}

interface CompletedPayload {
  status: "completed";
  completedAt: number;
  response: IdempotentCachedResponse;
}

type IdempotencyStoredPayload = InFlightPayload | CompletedPayload;

function formatRedisKey(key: string): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${key}`;
}

/**
 * Attempts to atomically acquire a lock for the given idempotency key.
 *
 * 1. Checks if Redis is configured. If not, falls back to database constraints.
 * 2. Uses `SET idempotency:${key} '{"status":"processing",...}' EX 120 NX` for atomic locking.
 * 3. If lock is acquired -> returns `{ status: "acquired" }`.
 * 4. If key already exists:
 *    - If status === "completed" -> returns `{ status: "cached", response }`.
 *    - If status === "processing" -> returns `{ status: "in_flight", retryAfter: 5 }`.
 * 5. In case of Redis errors, gracefully falls back.
 */
export async function acquireIdempotencyLock(
  key: string,
  leaseSeconds: number = DEFAULT_LOCK_LEASE_SECONDS
): Promise<IdempotencyLockResult> {
  if (!isRedisConfigured()) {
    return { status: "fallback" };
  }

  const client = await getRedisClient();
  if (!client) {
    return { status: "fallback" };
  }

  const redisKey = formatRedisKey(key);
  const now = Date.now();
  const inFlightPayload: InFlightPayload = {
    status: "processing",
    startedAt: now,
  };

  try {
    // Atomic SET key value EX leaseSeconds NX
    const result = await client.set(
      redisKey,
      JSON.stringify(inFlightPayload),
      "EX",
      leaseSeconds,
      "NX"
    );

    if (result === "OK" || result === true) {
      return { status: "acquired" };
    }

    // Key already exists — check current state
    const existingRaw = await client.get(redisKey);
    if (!existingRaw) {
      // Key expired in race condition; attempt one re-acquire
      const retryResult = await client.set(
        redisKey,
        JSON.stringify(inFlightPayload),
        "EX",
        leaseSeconds,
        "NX"
      );
      if (retryResult === "OK" || retryResult === true) {
        return { status: "acquired" };
      }
      return { status: "in_flight", retryAfter: DEFAULT_RETRY_AFTER_SECONDS };
    }

    try {
      const parsed = JSON.parse(existingRaw) as IdempotencyStoredPayload;
      if (parsed.status === "completed" && parsed.response) {
        return {
          status: "cached",
          response: parsed.response,
        };
      }
      return {
        status: "in_flight",
        retryAfter: DEFAULT_RETRY_AFTER_SECONDS,
      };
    } catch {
      // Unparseable existing content — treat as in-flight
      return {
        status: "in_flight",
        retryAfter: DEFAULT_RETRY_AFTER_SECONDS,
      };
    }
  } catch (err) {
    console.warn(
      `[idempotency] Failed to operate Redis lock for key ${key}, falling back to DB uniqueness.`,
      String(err)
    );
    return { status: "fallback" };
  }
}

/**
 * Marks the idempotency key as completed and caches the batch creation response for 24 hours.
 */
export async function completeIdempotency(
  key: string,
  response: IdempotentCachedResponse,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS
): Promise<void> {
  if (!isRedisConfigured()) return;

  const client = await getRedisClient();
  if (!client) return;

  const redisKey = formatRedisKey(key);
  const payload: CompletedPayload = {
    status: "completed",
    completedAt: Date.now(),
    response,
  };

  try {
    await client.set(
      redisKey,
      JSON.stringify(payload),
      "EX",
      ttlSeconds
    );
  } catch (err) {
    console.warn(
      `[idempotency] Failed to cache completed response for key ${key}.`,
      String(err)
    );
  }
}

/**
 * Releases the in-flight lock if a request fails or errors before completion.
 * Only deletes the key if it is currently in "processing" status, preserving cached completions.
 */
export async function releaseIdempotencyLock(key: string): Promise<void> {
  if (!isRedisConfigured()) return;

  const client = await getRedisClient();
  if (!client) return;

  const redisKey = formatRedisKey(key);

  try {
    const raw = await client.get(redisKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as IdempotencyStoredPayload;
      if (parsed.status === "processing") {
        await client.del(redisKey);
      }
    } catch {
      // Malformed value — safe to delete lock
      await client.del(redisKey);
    }
  } catch (err) {
    console.warn(
      `[idempotency] Failed to release lock for key ${key}.`,
      String(err)
    );
  }
}
