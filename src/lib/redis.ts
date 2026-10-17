// SPDX-License-Identifier: MIT

/**
 * Optional shared Redis client (issue #1366).
 *
 * Redis is an *optimisation* in this codebase, never a dependency: every
 * caller must keep working with `REDIS_URL` unset, ioredis uninstalled (it is
 * an optional dependency), or a broker that is simply down. This module owns
 * the connect-once / degrade-quietly policy so each feature does not have to
 * re-implement it, and hands out `null` rather than throwing.
 *
 * The client is intentionally minimal — only the commands the idempotency
 * layer needs are on the interface, so a test double is a small object rather
 * than a full ioredis mock. Existing modules (`src/lib/api-cache.ts`,
 * `src/lib/session-revocation.ts`, `src/lib/rate-limit.ts`) still hold their own
 * connections because they were written before this module existed; migrating
 * them is a follow-up, not a prerequisite.
 */

/** The slice of the ioredis surface this module relies on. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /**
   * ioredis' variadic form: `set(key, value, "EX" | "PX", ttl, "NX" | "XX")`.
   * Returns `"OK"` when the write happened and `null` when `NX`/`XX` declined.
   */
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  /** Present on ioredis; used for atomic compare-and-delete. */
  eval?(
    script: string,
    numberOfKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  on?(event: "error", listener: (err: unknown) => void): unknown;
  quit?(): Promise<unknown>;
}

/** How long to wait for the handshake before giving up on this process. */
const REDIS_CONNECT_TIMEOUT_MS = 2_000;

let client: RedisLike | null = null;
let unavailable = false;
let connecting: Promise<void> | null = null;

/**
 * Connect on first use. Never throws: an unreachable or uninstallable Redis
 * leaves the caller on its own fallback path.
 */
export function getRedisClient(): Promise<RedisLike | null> {
  if (client) return Promise.resolve(client);
  if (unavailable) return Promise.resolve(null);
  if (connecting) return connecting.then(() => client);

  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      // Expected for local dev and single-instance deploys — stay quiet.
      unavailable = true;
      return;
    }

    try {
      // Dynamic import: ioredis is an optional dependency and the app must
      // build and run without it installed.
      const mod = await import("ioredis");
      const Redis = mod.Redis ?? mod.default;
      const created = new Redis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      }) as unknown as RedisLike;
      // ioredis emits 'error' on the client; without a listener that becomes an
      // unhandled error event and can crash the process. Every caller already
      // treats a failed command as "unavailable", so just record it quietly.
      created.on?.("error", () => {});
      await (
        created as unknown as { connect: () => Promise<void> }
      ).connect();
      client = created;
    } catch {
      unavailable = true;
    } finally {
      connecting = null;
    }
  })();

  return connecting.then(() => client);
}

/**
 * Run an operation, disabling Redis for this process on any failure.
 *
 * A broker that errored once is marked unavailable: retrying it on every
 * request would add a failed round trip to the hot path of a route whose
 * fallback already works.
 */
export async function withRedis<T>(
  op: (redis: RedisLike) => Promise<T>,
  fallback: T
): Promise<T> {
  const redis = await getRedisClient();
  if (!redis) return fallback;

  try {
    return await op(redis);
  } catch {
    client = null;
    unavailable = true;
    return fallback;
  }
}

/** Forget the cached connection (tests, and an operator-triggered reconnect). */
export function resetRedisClient(): void {
  client = null;
  unavailable = false;
  connecting = null;
}

/**
 * Inject a client — the test seam for the idempotency suite, which must run
 * without a broker. `null` restores the real connect path.
 */
export function setRedisClientForTests(next: RedisLike | null): void {
  resetRedisClient();
  if (next) {
    client = next;
    unavailable = false;
  }
}
