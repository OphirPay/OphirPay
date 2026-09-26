// SPDX-License-Identifier: MIT

/**
 * Read-through cache for the explicitly read-only endpoints (issue #741).
 *
 * The read-heavy routes (`/api/stats`, `/api/analytics`, `/api/contracts`, the
 * contract-backed `/api/audit-log`) either simulate a contract call or
 * aggregate the database on every request — the most expensive path in the
 * app. This module serves them from a short-lived cache instead, with an
 * explicit invalidation path for the mutations that change the data.
 *
 * Two tiers:
 *
 *   • L1 — a per-process in-memory map. Zero round trips, but only consistent
 *     within one replica.
 *   • L2 — Redis, used when `REDIS_URL` is set. Shared across replicas, so a
 *     mutation handled by one instance is visible to the others.
 *
 * Degradation is deliberate: if `REDIS_URL` is unset, or ioredis is not
 * installed, or the connection fails, every operation silently falls back to
 * L1/uncached behaviour and the request is served normally. The cache is an
 * optimization, never a dependency.
 *
 * Financial reads are authenticated and derived, so hitting a stale entry is
 * only acceptable for the length of the TTL — hence the deliberately short
 * TTLs in {@link READ_TTL_MS} and the `no-store` response headers the routes
 * pair them with (`readCacheHeaders()` in `src/lib/cache.ts`).
 */

// ── Configuration ──────────────────────────────────────────────

/** Read-only endpoint families the cache knows about. */
export type CacheScope =
  | "stats"
  | "analytics"
  | "contracts"
  | "audit-log"
  | "fee-config";

/**
 * Time-to-live per scope.
 *
 * Short by design: these payloads are financial, and the acceptance bar is
 * "stale for seconds", never "stale for minutes". A mutation additionally
 * invalidates the affected keys immediately (see {@link invalidateCache}), so
 * the TTL is the backstop, not the correctness mechanism.
 */
export const READ_TTL_MS: Record<CacheScope, number> = {
  stats: 15_000,
  analytics: 30_000,
  contracts: 60_000,
  "audit-log": 5_000,
  "fee-config": 30_000,
};

/** Default TTL for generic cached fetches (contract simulations). */
export const DEFAULT_TTL_MS = 30_000;

/** Redis key prefix — namespaced so a shared Redis can host other apps. */
const KEY_PREFIX = "ophirpay:cache";

/** How long to wait for the Redis handshake before giving up on it. */
const REDIS_CONNECT_TIMEOUT_MS = 2_000;

/** Upper bound on prefix-invalidation work, so one request can't scan forever. */
const MAX_SCAN_ITERATIONS = 10;

/**
 * Build the cache key for a scope. `subject` narrows the entry — a user id for
 * per-user data, a contract id for chain reads, `"all"` for global payloads.
 */
export function readCacheKey(scope: CacheScope, subject = "all"): string {
  return `${KEY_PREFIX}:${scope}:${subject}`;
}

// ── L1: in-memory store ────────────────────────────────────────

interface CacheEntry {
  /** Serialized payload — the same representation Redis stores. */
  value: string;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

function memoryGet(key: string): string | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function memoryDeleteByPrefix(prefix: string): number {
  let deleted = 0;
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      deleted++;
    }
  }
  return deleted;
}

// ── L2: Redis (optional) ───────────────────────────────────────

/** The slice of the ioredis surface this module relies on. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(
    cursor: string,
    mode: "MATCH",
    pattern: string,
    countMode: "COUNT",
    count: number
  ): Promise<[string, string[]]>;
  on?(event: "error", listener: (err: unknown) => void): unknown;
  quit?(): Promise<unknown>;
}

let redis: RedisLike | null = null;
let redisUnavailable = false;
let connecting: Promise<void> | null = null;

/**
 * Connect to Redis on first use. Never throws: an unreachable/uninstallable
 * Redis leaves the cache on L1, which keeps the app running with
 * `REDIS_URL` unset or wrong.
 */
function ensureRedis(): Promise<void> {
  if (redis || redisUnavailable) return Promise.resolve();
  if (connecting) return connecting;

  connecting = (async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      // No Redis configured — expected for local dev and single-instance
      // deploys. Stay on L1 without warning noise.
      redisUnavailable = true;
      return;
    }

    try {
      // Dynamic import — ioredis is an optional dependency, and the app must
      // build and run without it installed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import("ioredis");
      const client = new (mod.Redis ?? mod.default)(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      });
      // ioredis emits 'error' on the client; without a listener that becomes an
      // unhandled error event and can crash the process. Every read already
      // treats a Redis failure as a miss, so just record it quietly here.
      client.on?.("error", () => {});
      await client.connect();
      redis = client as RedisLike;
      console.log("[api-cache] Using Redis backend");
    } catch (err) {
      redisUnavailable = true;
      console.warn(
        "[api-cache] Redis unavailable — read caching falls back to in-process memory.",
        String(err)
      );
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

/**
 * Run a Redis operation, degrading to `fallback` on any failure.
 *
 * A Redis error mid-flight permanently marks L2 unavailable for this process:
 * once the backend is gone, repeatedly probing it would add a failed round trip
 * to every read.
 */
async function withRedis<T>(
  op: (client: RedisLike) => Promise<T>,
  fallback: T
): Promise<T> {
  await ensureRedis();
  if (!redis) return fallback;

  try {
    return await op(redis);
  } catch (err) {
    console.warn("[api-cache] Redis operation failed — disabling L2 cache.", String(err));
    redis = null;
    redisUnavailable = true;
    return fallback;
  }
}

// ── Read-through API ───────────────────────────────────────────

/** Result of a cached read, including whether the cache served it. */
export interface CachedRead<T> {
  value: T;
  /** `HIT` when served from L1/L2, `MISS` when the loader ran. */
  status: "HIT" | "MISS";
}

function decode<T>(raw: string | null | undefined): T | undefined {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt entry — treat as a miss so the loader repopulates it.
    return undefined;
  }
}

/**
 * Serve `key` from the cache, or run `loader` and cache its result.
 *
 * Lookup order is L1 → L2 → loader. On a miss the value is written to both
 * tiers with `ttlMs`. Exceptions from `loader` are never cached, so a failing
 * chain/database read doesn't pin an error for the whole TTL.
 */
export async function cachedRead<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<CachedRead<T>> {
  const fromMemory = decode<T>(memoryGet(key));
  if (fromMemory !== undefined) return { value: fromMemory, status: "HIT" };

  const fromRedis = decode<T>(
    await withRedis<string | null>((client) => client.get(key), null)
  );
  if (fromRedis !== undefined) {
    // Warm L1 so the next request on this replica skips the Redis round trip.
    memorySet(key, JSON.stringify(fromRedis), ttlMs);
    return { value: fromRedis, status: "HIT" };
  }

  const value = await loader();

  let serialized: string | null = null;
  try {
    serialized = JSON.stringify(value);
  } catch {
    // Non-serializable payload (e.g. cycles): skip caching entirely rather
    // than serving a mangled value later.
    serialized = null;
  }

  if (serialized !== null) {
    memorySet(key, serialized, ttlMs);
    await withRedis<unknown>(
      (client) => client.set(key, serialized as string, "PX", ttlMs),
      null
    );
  }

  return { value, status: "MISS" };
}

/**
 * Cache-and-return helper kept for existing callers (governance routes).
 * Prefer {@link cachedRead} when the response should report hit/miss.
 */
export async function cachedFetch<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const { value } = await cachedRead(key, fn, ttlMs);
  return value;
}

// ── Invalidation ───────────────────────────────────────────────

/**
 * Drop cached entries.
 *
 * Without `subject`, every entry in the scope is removed (prefix delete, both
 * tiers). With a `subject`, only that entry is removed — the precise form to
 * use for per-user payloads, so one user's write doesn't flush everyone's
 * cache.
 *
 * Call this from every mutation that changes the underlying data; the TTL is
 * the backstop, not the mechanism.
 */
export async function invalidateCache(
  scope: CacheScope,
  subject?: string
): Promise<void> {
  if (subject !== undefined) {
    const key = readCacheKey(scope, subject);
    store.delete(key);
    await withRedis<unknown>((client) => client.del(key), null);
    return;
  }

  const prefix = `${KEY_PREFIX}:${scope}:`;
  memoryDeleteByPrefix(prefix);

  await withRedis<number | null>(async (client) => {
    let cursor = "0";
    for (let i = 0; i < MAX_SCAN_ITERATIONS; i++) {
      const [next, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      if (keys.length > 0) await client.del(...keys);
      cursor = next;
      if (cursor === "0") break;
    }
    return null;
  }, null);
}

/**
 * Invalidate several scopes at once — the shape a mutation usually needs
 * (e.g. recording a payment changes stats, the writer's analytics and the
 * on-chain audit ledger).
 */
export async function invalidateCaches(
  entries: Array<{ scope: CacheScope; subject?: string }>
): Promise<void> {
  await Promise.all(entries.map(({ scope, subject }) => invalidateCache(scope, subject)));
}

// ── Compatibility + introspection ──────────────────────────────

/**
 * Synchronous getter over L1 only. Retained for callers that must not await;
 * new code should use {@link cachedRead}.
 */
export function cacheGet<T>(key: string): T | undefined {
  return decode<T>(memoryGet(key));
}

/** Set an L1 entry (L2 is populated by {@link cachedRead}). */
export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    memorySet(key, JSON.stringify(data), ttlMs);
  } catch {
    // Non-serializable payload — skip.
  }
}

/** Delete one key from L1. Prefer `await invalidateCache(scope, subject)`. */
export function cacheDelete(key: string): void {
  store.delete(key);
  void withRedis<unknown>((client) => client.del(key), null);
}

/** Clear L1 only. Prefer `await invalidateCache(scope)` to also clear L2. */
export function cacheClear(): void {
  store.clear();
}

/** Introspection for tests and the `/api/health` cache probe. */
export function cacheStats(): {
  size: number;
  keys: string[];
  backend: "memory" | "redis";
  redisConfigured: boolean;
} {
  for (const [key, entry] of store) {
    if (Date.now() > entry.expiresAt) store.delete(key);
  }
  return {
    size: store.size,
    keys: Array.from(store.keys()),
    backend: redis ? "redis" : "memory",
    redisConfigured: Boolean(process.env.REDIS_URL) && !redisUnavailable,
  };
}

/**
 * Force a Redis reconnection attempt (tests, or after a transient outage).
 * Also clears L1 so a test starts from a known state.
 */
export async function resetReadCache(): Promise<void> {
  store.clear();
  redis = null;
  redisUnavailable = false;
  connecting = null;
  await ensureRedis();
}
