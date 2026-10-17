// SPDX-License-Identifier: MIT

/**
 * Server-side session revocation (issue #1399).
 *
 * A session cookie is a stateless HMAC — verifying it proves it was *issued*
 * by this server, not that it is still *wanted*. Logout therefore has two
 * effects:
 *
 *   1. The browser clears the cookie (`Max-Age=0`), which every tab shares, so
 *      open tabs can no longer present a valid cookie on their next request.
 *   2. The wallet's outstanding tokens are recorded as revoked here, so a
 *      cookie captured before logout (a stolen copy, a saved HAR, a tab that
 *      never re-renders) stops authenticating immediately.
 *
 * Revocation is keyed by wallet public key and remembers the instant of the
 * logout: any token issued at or before that instant is rejected. That
 * invalidates every tab and every device at once, without enumerating tokens,
 * and expires on its own after {@link REVOCATION_TTL_MS} — well past the point
 * where the token it invalidates would have expired anyway.
 *
 * Storage mirrors `api-cache.ts`: Redis when `REDIS_URL` is set (shared across
 * replicas), an in-process map otherwise. Degradation is deliberate — a Redis
 * outage must not log the whole platform out, so an unreachable Redis leaves
 * revocation working per-instance rather than failing closed on every request.
 */

/** Must match `SESSION_TTL_MS` in `auth-session.ts` (asserted by the test suite). */
export const REVOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const KEY_PREFIX = "ophirpay:session-revoked";
const REDIS_CONNECT_TIMEOUT_MS = 2_000;

// ── L1: in-memory store ────────────────────────────────────────

/** publicKey → revoked-at epoch ms. */
const memory = new Map<string, number>();

/**
 * Wallet keys this process has written to Redis, so {@link resetSessionRevocation}
 * can clear them again (tests, and a deliberate operator reset) without a SCAN.
 */
const writtenKeys = new Set<string>();

function memoryGet(publicKey: string): number | null {
  const revokedAt = memory.get(publicKey);
  if (revokedAt === undefined) return null;
  if (Date.now() - revokedAt > REVOCATION_TTL_MS) {
    memory.delete(publicKey);
    return null;
  }
  return revokedAt;
}

// ── L2: Redis (optional) ───────────────────────────────────────

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  on?(event: "error", listener: (err: unknown) => void): unknown;
  quit?(): Promise<unknown>;
}

let redis: RedisLike | null = null;
let redisUnavailable = false;
let connecting: Promise<void> | null = null;

function keyFor(publicKey: string): string {
  return `${KEY_PREFIX}:${publicKey}`;
}

/**
 * Connect to Redis on first use. Never throws: an unreachable or uninstalled
 * Redis leaves revocation on the in-process store.
 */
function ensureRedis(): Promise<void> {
  if (redis || redisUnavailable) return Promise.resolve();
  if (connecting) return connecting;

  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      redisUnavailable = true;
      return;
    }
    try {
      // Dynamic import — ioredis is an optional dependency and the app must
      // build and run without it installed.
      const mod = await import("ioredis");
      const Redis = mod.Redis ?? mod.default;
      const client = new Redis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      });
      // ioredis emits 'error'; without a listener that becomes an unhandled
      // error event. Every read treats a failure as "not revoked".
      client.on?.("error", () => {});
      await client.connect();
      redis = client;
      console.log("[session-revocation] Using Redis backend");
    } catch (err) {
      redisUnavailable = true;
      console.warn(
        "[session-revocation] Redis unavailable — revocation is per-instance.",
        String(err)
      );
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

async function withRedis<T>(
  op: (client: RedisLike) => Promise<T>,
  fallback: T
): Promise<T> {
  await ensureRedis();
  if (!redis) return fallback;
  try {
    return await op(redis);
  } catch (err) {
    console.warn(
      "[session-revocation] Redis operation failed — disabling shared revocation.",
      String(err)
    );
    redis = null;
    redisUnavailable = true;
    return fallback;
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Revoke every session issued for `publicKey` at or before `revokedAt`.
 * Idempotent; safe to call with an unknown or empty key.
 */
export async function revokeWalletSessions(
  publicKey: string,
  revokedAt: number = Date.now()
): Promise<void> {
  if (!publicKey) return;
  memory.set(publicKey, revokedAt);
  writtenKeys.add(publicKey);
  await withRedis<unknown>(
    (client) => client.set(keyFor(publicKey), String(revokedAt), "PX", REVOCATION_TTL_MS),
    null
  );
}

/**
 * True when `publicKey`'s session — identified by the token's `issuedAt` — has
 * been revoked.
 *
 * A token minted before this module tracked `iat` cannot be compared, so it is
 * treated as revoked once its wallet logs out (fail-safe, never fail-open).
 */
export async function isWalletRevoked(
  publicKey: string,
  issuedAt?: number
): Promise<boolean> {
  if (!publicKey) return false;

  let revokedAt = memoryGet(publicKey);
  if (revokedAt === null) {
    const remote = await withRedis<string | null>(
      (client) => client.get(keyFor(publicKey)),
      null
    );
    if (remote !== null) {
      const parsed = Number(remote);
      if (Number.isFinite(parsed)) {
        // Warm L1 so the next request on this replica skips the round trip.
        memory.set(publicKey, parsed);
        revokedAt = parsed;
      }
    }
  }

  if (revokedAt === null) return false;
  if (typeof issuedAt !== "number") return true;
  return issuedAt <= revokedAt;
}

/**
 * Drop revocation state this process created — both the in-memory map and the
 * Redis keys it wrote. Used to keep tests hermetic when a shared Redis is
 * configured; never called from request handling.
 */
export async function resetSessionRevocation(): Promise<void> {
  if (redis && writtenKeys.size > 0) {
    try {
      await redis.del(...Array.from(writtenKeys, keyFor));
    } catch {
      // Best-effort cleanup — a failed delete must not mask the test result.
    }
  }
  writtenKeys.clear();
  memory.clear();
  redis = null;
  redisUnavailable = false;
  connecting = null;
}
