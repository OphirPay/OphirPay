// SPDX-License-Identifier: MIT

/**
 * Redis-backed idempotency for expensive mutations (issue #1366).
 *
 * A batch submission assembles and stores many rows over several seconds. The
 * existing guard — "look up `(userId, idempotencyKey)` before inserting" — only
 * closes the window *after* the first insert commits. Two retries that arrive
 * while the first request is still working both see no row, both insert, and
 * the loser is rejected by the unique index (or, worse, both succeed when the
 * key is server-generated). The client sees a 409 for what was a legitimate
 * retry, and a network blip can cost a whole batch.
 *
 * This module adds a lease *before* the work starts:
 *
 *   1. `SET idempotency:lock:<user>:<key> <token> EX 120 NX` — atomic, so
 *      exactly one request wins. Every other in-flight attempt is told the
 *      first one is still working (409 + `Retry-After`), which is truthful and
 *      actionable instead of a race.
 *   2. A completed response is cached for 24 h. A retry after completion is
 *      served the byte-identical 201 it would have received, marked with
 *      `Idempotent-Replay: true` so callers can tell a replay from fresh work.
 *   3. The lease is released in `finally` (compare-and-delete, so a lease that
 *      expired and was re-acquired by someone else is never deleted by the
 *      original holder). A failed request therefore frees the key immediately
 *      instead of blocking retries for the full 120 s.
 *
 * Degradation: without Redis every function returns `unavailable`, and the
 * route keeps its pre-existing database-only guarantee (the unique index on
 * `(userId, idempotencyKey)` plus the resume-on-retry path). Correctness never
 * depends on the cache being up — it only loses *availability* under
 * concurrent retries, which is the status quo this issue improves on.
 *
 * Keys are namespaced by user because idempotency keys come from the client:
 * two tenants can legitimately pick the same string, and one must never read
 * another's cached response.
 */

import crypto from "node:crypto";
import {
  withRedis,
  type RedisLike,
} from "@/lib/redis";

/** How long one in-flight request may hold the claim (seconds). */
export const IDEMPOTENCY_LOCK_TTL_SECONDS = 120;

/** How long a completed response stays replayable (24 hours). */
export const IDEMPOTENCY_RESPONSE_TTL_SECONDS = 24 * 60 * 60;

/** What the caller should tell the client to wait before retrying a 409. */
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 5;

const LOCK_PREFIX = "idempotency:lock";
const RESPONSE_PREFIX = "idempotency:response";

/**
 * Compare-and-delete: release only the lease this request owns.
 *
 * `DEL` alone would be wrong — if our 120 s lease expired mid-request and a
 * retry acquired a fresh one, a blind delete would erase *their* lock and let
 * a third request start concurrently with it.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

/** A stored response, in the subset of HTTP that a replay needs. */
export interface CachedIdempotentResponse {
  status: number;
  /** The exact JSON body the first request returned. */
  body: unknown;
}

/** Result of trying to claim an idempotency key. */
export type IdempotencyClaim =
  | {
      status: "acquired";
      /** Store the response for later replays, then release the lease. */
      remember(response: CachedIdempotentResponse): Promise<void>;
      /** Release the lease without caching (failure path). */
      release(): Promise<void>;
    }
  | {
      status: "replay";
      response: CachedIdempotentResponse;
    }
  | {
      status: "in-flight";
      retryAfterSeconds: number;
    }
  | {
      /** No Redis: the caller must rely on its database-only guard. */
      status: "unavailable";
    };

function lockKey(userId: string, idempotencyKey: string): string {
  return `${LOCK_PREFIX}:${userId}:${idempotencyKey}`;
}

function responseKey(userId: string, idempotencyKey: string): string {
  return `${RESPONSE_PREFIX}:${userId}:${idempotencyKey}`;
}

function parseCached(raw: string | null | undefined): CachedIdempotentResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedIdempotentResponse>;
    if (typeof parsed.status !== "number") return null;
    return { status: parsed.status, body: parsed.body };
  } catch {
    return null;
  }
}

/**
 * Claim `idempotencyKey` for `userId`.
 *
 * Order matters: the completed-response cache is consulted *before* the lock,
 * so a retry that lands after the first request finished is answered with the
 * cached result even if the lease has not expired yet.
 */
export async function claimIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<IdempotencyClaim> {
  const token = crypto.randomUUID();

  return withRedis<IdempotencyClaim>(async (redis: RedisLike) => {
    const replay = parseCached(await redis.get(responseKey(userId, idempotencyKey)));
    if (replay) return { status: "replay", response: replay };

    const acquired = await redis.set(
      lockKey(userId, idempotencyKey),
      token,
      "EX",
      IDEMPOTENCY_LOCK_TTL_SECONDS,
      "NX"
    );

    // ioredis returns "OK" for a successful SET and null when NX declined.
    // A broker that answers with anything else is treated as "not acquired":
    // answering 409 is safe (the client retries), whereas proceeding would
    // re-open the race this lock exists to close.
    if (acquired !== "OK") {
      return {
        status: "in-flight",
        retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS,
      };
    }

    const release = async () => {
      await withRedis(async (client) => {
        if (typeof client.eval === "function") {
          await client.eval(RELEASE_SCRIPT, 1, lockKey(userId, idempotencyKey), token);
          return null;
        }
        // No EVAL (a very minimal test double): fall back to DEL. The
        // compare-and-delete is a safety net for lease expiry, not the
        // primary guarantee.
        await client.del(lockKey(userId, idempotencyKey));
        return null;
      }, null);
    };

    return {
      status: "acquired" as const,
      async remember(response: CachedIdempotentResponse) {
        await withRedis(async (client) => {
          await client.set(
            responseKey(userId, idempotencyKey),
            JSON.stringify(response),
            "EX",
            IDEMPOTENCY_RESPONSE_TTL_SECONDS
          );
          return null;
        }, null);
        await release();
      },
      release,
    };
  }, { status: "unavailable" });
}

/**
 * Read a cached response without claiming anything.
 *
 * Exposed for routes that want to answer a replay before doing any work (and
 * for tests); `claimIdempotencyKey` already consults the same cache.
 */
export async function readIdempotentResponse(
  userId: string,
  idempotencyKey: string
): Promise<CachedIdempotentResponse | null> {
  return withRedis(async (redis) => {
    return parseCached(await redis.get(responseKey(userId, idempotencyKey)));
  }, null);
}

/** Drop both the cached response and the lease (tests, operator tooling). */
export async function forgetIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<void> {
  await withRedis(async (redis) => {
    await redis.del(
      responseKey(userId, idempotencyKey),
      lockKey(userId, idempotencyKey)
    );
    return null;
  }, null);
}
