// SPDX-License-Identifier: MIT

/**
 * Consolidated rate-limit store with pluggable backends.
 *
 * • In-memory            (dev / single instance)
 * • Redis over TCP       (Node runtime — `redis://` / `rediss://` REDIS_URL)
 * • Redis over HTTP/REST (any runtime, including edge — `https://` REDIS_URL
 *                         or REDIS_REST_URL, Upstash-compatible)
 *
 * The store is lazily initialised on first use.
 *
 * Why three backends: the global limit in `src/proxy.ts` runs on the Edge
 * runtime, where `ioredis` (a Node net client) cannot run. The rest of the
 * app runs on Node and *can* use `ioredis`. We therefore pick the transport
 * from the shape of `REDIS_URL`:
 *
 *   redis://…    → ioredis (Node only; edge falls back to in-memory)
 *   https://…    → fetch-based REST client (works on edge *and* Node)
 *
 * Set the matching token (`REDIS_TOKEN`, `REDIS_REST_TOKEN` or
 * `UPSTASH_REDIS_REST_TOKEN`) for hosted REST providers such as Upstash.
 * With neither configured the in-memory store is used, exactly as before.
 *
 * This is the *single* rate-limit module (issue #759). On top of the store it
 * owns the three things that used to be duplicated across the auth, lookup and
 * proxy callers:
 *
 *   • the bucket-key builder   — `buildRateLimitKey()`
 *   • the response header set  — `formatRateLimitHeaders()`
 *   • the endpoint policies    — `AUTH_RATE_LIMIT_POLICY`, etc. (data, not code)
 *
 * `enforceRateLimit()` is the generic entry point: a caller passes a policy and
 * the shared store enforces the per-IP and (optional) per-target buckets. The
 * auth and lookup modules are now thin wrappers over these policies, and the
 * edge proxy consumes the same store/interface and header writer.
 */

import { ERROR_CODES, errorEnvelope } from "@/lib/error-codes";

// ── Interface ──────────────────────────────────────────────────

export interface RateLimitResult {
  /** Whether this request is within the limit */
  allowed: boolean;
  /** How many requests remain in the current window */
  remaining: number;
  /** Unix-ms timestamp when the window resets */
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Increment the counter for `key` and return the current state.
   *
   * @param key        Unique identifier (e.g. IP address)
   * @param windowMs   Sliding-window duration in milliseconds
   * @param maxRequests  Maximum allowed requests in the window
   */
  increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult>;

  /** Reset the counter for `key` (e.g. on auth success). */
  reset(key: string): Promise<void>;
}

/**
 * Seconds (rounded up) until the current window resets.
 *
 * Used to populate the `Retry-After` header on 429 responses so clients can
 * back off correctly. Never returns a negative value.
 */
export function getRetryAfterSeconds(result: RateLimitResult): number {
  return Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
}

// ── In-Memory Store ────────────────────────────────────────────

export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetAt: number }>();

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
    }

    entry.count++;
    this.store.set(key, entry);

    // Periodic cleanup — prevent unbounded memory growth under abuse
    if (this.store.size > 10_000) {
      for (const [k, v] of this.store) {
        if (v.resetAt < now) this.store.delete(k);
      }
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    return { allowed: entry.count <= maxRequests, remaining, resetAt: entry.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ── Redis Store (ioredis / node-redis, Node runtime) ───────────

export class RedisRateLimitStore implements RateLimitStore {
  // Lightweight Redis client interface — works with ioredis, node-redis, or Upstash
  constructor(
    private redis: {
      incr: (key: string) => Promise<number>;
      expire: (key: string, seconds: number) => Promise<unknown>;
      del: (key: string) => Promise<unknown>;
    }
  ) {}

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const ttl = Math.ceil(windowMs / 1000);

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttl);
    }

    const remaining = Math.max(0, maxRequests - count);
    return { allowed: count <= maxRequests, remaining, resetAt: now + windowMs };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

// ── Redis over HTTP/REST (edge-safe) ───────────────────────────
//
// Speaks the Upstash Redis REST protocol: the command is POSTed as a JSON
// array and the reply is `{ result }`. This is the only Redis transport that
// works on the Edge runtime, so it is what `src/proxy.ts` uses when an
// HTTP(S) REDIS_URL/REDIS_REST_URL is configured.

export interface HttpRedisRateLimitStoreOptions {
  /** REST endpoint, e.g. https://eu1-xxxx.upstash.io */
  url: string;
  /** Bearer token for hosted Redis (optional for local REST proxies). */
  token?: string;
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class HttpRedisRateLimitStore implements RateLimitStore {
  private readonly url: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpRedisRateLimitStoreOptions) {
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async command(command: (string | number)[]): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis REST command failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: string;
    };
    if (payload.error) {
      throw new Error(`Redis REST error: ${payload.error}`);
    }
    return payload.result;
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const ttl = Math.ceil(windowMs / 1000);

    // INCR is atomic on the Redis side, so every replica observes the same
    // counter — this is what makes the limit global across instances.
    const count = Number(await this.command(["INCR", key]));
    if (count === 1) {
      await this.command(["EXPIRE", key, ttl]);
    }

    const remaining = Math.max(0, maxRequests - count);
    return { allowed: count <= maxRequests, remaining, resetAt: now + windowMs };
  }

  async reset(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }
}

// ── Backend selection ──────────────────────────────────────────

const HTTP_REDIS_URL = /^https?:\/\//i;
const TCP_REDIS_URL = /^rediss?:\/\//i;

/** True when `url` is a remote HTTP(s) Redis REST endpoint (edge-safe). */
export function isHttpRedisUrl(url: string | undefined): boolean {
  return typeof url === "string" && HTTP_REDIS_URL.test(url);
}

/**
 * Resolve the HTTP/REST Redis endpoint from the environment.
 *
 * `REDIS_URL` is accepted when it is an http(s) URL, so the single documented
 * variable keeps working for hosted REST providers. Explicit
 * `REDIS_REST_URL` / `UPSTASH_REDIS_REST_URL` take precedence.
 */
export function getRedisRestConfig(): { url: string; token?: string } | null {
  const url =
    process.env.REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    (isHttpRedisUrl(process.env.REDIS_URL) ? process.env.REDIS_URL : undefined);
  if (!url) return null;

  return {
    url,
    token:
      process.env.REDIS_REST_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.REDIS_TOKEN,
  };
}

/**
 * Synchronous backend selection, safe to call from the Edge runtime.
 *
 * Returns a REST-backed store when an HTTP Redis endpoint is configured and
 * the in-memory store otherwise. Never throws and never performs I/O, so it
 * is safe to run at module scope in middleware.
 */
export function createRateLimitStoreFromEnv(): RateLimitStore {
  const rest = getRedisRestConfig();
  if (rest) return new HttpRedisRateLimitStore(rest);
  return new InMemoryRateLimitStore();
}

// ── Singleton Lifecycle ────────────────────────────────────────

let _store: RateLimitStore | null = null;

/**
 * Return the current rate-limit store.
 *
 * Lazy-initialises from the environment on first use, so the Edge proxy
 * shares one store per instance (and shares *state* across instances when a
 * REST Redis endpoint is configured). Node callers should prefer running
 * `initRateLimitStore()` during bootstrap so ioredis can be used.
 */
export function getRateLimitStore(): RateLimitStore {
  if (!_store) {
    _store = createRateLimitStoreFromEnv();
  }
  return _store;
}

/** Replace the store at runtime (call during app bootstrap or in tests). */
export function setRateLimitStore(store: RateLimitStore): void {
  _store = store;
}

/**
 * Initialise the rate-limit store during Node startup.
 *
 * Preference order:
 *   1. HTTP/REST Redis (`https://…`) — works on every runtime.
 *   2. ioredis (`redis://…` / `rediss://…`) — Node runtime only.
 *   3. In-memory — single instance / no Redis.
 *
 * A failing Redis connection is non-fatal: we log and fall back to memory so
 * the app still boots. Call once from `src/instrumentation.ts`.
 */
export async function initRateLimitStore(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  // 1. HTTP/REST Redis — usable from the Node runtime too.
  if (
    isHttpRedisUrl(redisUrl) ||
    process.env.REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL
  ) {
    _store = createRateLimitStoreFromEnv();
    console.log("[rate-limit] Using Redis REST backend");
    return;
  }

  // 2. TCP Redis via ioredis (Node only; `ioredis` is an optional dep).
  if (redisUrl && TCP_REDIS_URL.test(redisUrl)) {
    try {
      // Dynamic import — ioredis is an optional dependency, absent on the edge.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RedisModule: any = await import("ioredis");
      const redis = new RedisModule.Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await redis.connect();
      _store = new RedisRateLimitStore(redis);
      console.log("[rate-limit] Using Redis backend");
      return;
    } catch (err) {
      console.warn(
        "[rate-limit] Redis unavailable — falling back to in-memory store.",
        String(err)
      );
    }
  }

  // 3. In-memory.
  _store = createRateLimitStoreFromEnv();
}

// ── Bucket keys, headers, policies and enforcement ─────────────
//
// Everything below is shared by the edge proxy and the Node route handlers so
// window semantics, bucket keys and header formatting cannot drift between
// them (issue #759).

/**
 * Read the client IP from the standard proxy headers.
 *
 * Accepts either a `Request`/`NextRequest` or anything exposing `headers.get`,
 * so the same helper serves route handlers and the edge middleware.
 */
export function getClientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Build a namespaced bucket key. Keeping the `scope:id` shape in one place is
 * what lets the edge and Node limiters share buckets safely.
 */
export function buildRateLimitKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

/**
 * Format the standard rate-limit response headers from a store result.
 *
 * This is the single header writer: `rate-limit-headers.ts`, the auth and
 * lookup 429 builders and `src/proxy.ts` all funnel through it, so a client
 * sees byte-identical `X-RateLimit-*` / `Retry-After` values regardless of
 * which limiter rejected it.
 */
export function formatRateLimitHeaders(input: {
  limit: number;
  remaining: number;
  /** Unix-ms timestamp when the window resets. */
  resetAt: number;
}): Record<string, string> {
  const resetSeconds = Math.ceil(input.resetAt / 1000);
  const retryAfter =
    input.remaining <= 0
      ? Math.max(1, resetSeconds - Math.floor(Date.now() / 1000))
      : 0;
  return {
    "Retry-After": String(retryAfter),
    "X-RateLimit-Limit": String(input.limit),
    "X-RateLimit-Remaining": String(input.remaining),
    "X-RateLimit-Reset": String(resetSeconds),
    "X-Content-Type-Options": "nosniff",
  };
}

/** Human-facing message used by every rate-limited response. */
export const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

/** Build the canonical 429 JSON response for a rejected request. */
export function rateLimitedResponse(
  code: string,
  limit: number,
  result: RateLimitResult,
): Response {
  return Response.json(errorEnvelope(code, RATE_LIMIT_MESSAGE), {
    status: 429,
    headers: formatRateLimitHeaders({
      limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
    }),
  });
}

/** A single bucket in a rate-limit policy. */
export interface RateLimitBucket {
  /** Historical key prefix, e.g. `auth:ip`. */
  scope: string;
  /** Error code emitted when this bucket is exhausted. */
  code: string;
  /** Max requests per window. Read lazily so env overrides apply per call. */
  limit: () => number;
}

/**
 * An endpoint policy expressed as data: a window, a per-IP bucket and an
 * optional per-target bucket (wallet / address). Adding an endpoint means
 * adding a policy object, not new enforcement code.
 */
export interface RateLimitPolicy {
  /** Stable name used for diagnostics and tests. */
  name: string;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Bucket charged on every request (keyed by client IP). */
  ip: RateLimitBucket;
  /** Optional second bucket keyed by a caller-supplied target. */
  target?: RateLimitBucket;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Wallet-auth endpoints (challenge mint / session issuance). */
export const AUTH_RATE_LIMIT_POLICY: RateLimitPolicy = {
  name: "auth",
  windowMs: 60_000,
  ip: {
    scope: "auth:ip",
    code: ERROR_CODES.RATE_LIMIT_IP,
    limit: () => envInt("AUTH_RATE_LIMIT_IP_RPM", 30),
  },
  target: {
    scope: "auth:wallet",
    code: ERROR_CODES.RATE_LIMIT_WALLET,
    limit: () => envInt("AUTH_RATE_LIMIT_WALLET_RPM", 10),
  },
};

/** Wallet/address lookup endpoints (enumeration + RPC hammering). */
export const LOOKUP_RATE_LIMIT_POLICY: RateLimitPolicy = {
  name: "lookup",
  windowMs: 60_000,
  ip: {
    scope: "lookup:ip",
    code: ERROR_CODES.RATE_LIMIT_IP,
    limit: () => envInt("LOOKUP_RATE_LIMIT_IP_RPM", 60),
  },
  target: {
    scope: "lookup:addr",
    code: ERROR_CODES.RATE_LIMIT_WALLET,
    limit: () => envInt("LOOKUP_RATE_LIMIT_ADDR_RPM", 30),
  },
};

/** Global per-IP limit enforced at the edge proxy for `/api/*`. */
export const GLOBAL_RATE_LIMIT_POLICY: RateLimitPolicy = {
  name: "global",
  windowMs: 60_000,
  ip: {
    scope: "global",
    code: ERROR_CODES.RATE_LIMITED,
    limit: () =>
      Math.max(1, parseInt(process.env.RATE_LIMIT_RPM || "120", 10) || 120),
  },
};

export interface EnforceRateLimitOptions {
  /** Charge the policy's target bucket against this value (if the policy has one). */
  target?: string;
  /** Per-call window override (tests). */
  windowMs?: number;
  /** Per-call per-IP limit override (tests). */
  ipLimit?: number;
  /** Per-call target-limit override (tests). */
  targetLimit?: number;
}

/**
 * Enforce a rate-limit policy against a request.
 *
 * Returns a 429 `Response` when the per-IP or per-target bucket is exhausted,
 * or `null` when the request is within every limit. Shared by the auth and
 * lookup routes; the edge proxy uses the store directly (it runs before route
 * dispatch).
 */
export async function enforceRateLimit(
  request: { headers: { get(name: string): string | null } },
  policy: RateLimitPolicy,
  opts: EnforceRateLimitOptions = {},
): Promise<Response | null> {
  const windowMs = opts.windowMs ?? policy.windowMs;
  const ipLimit = opts.ipLimit ?? policy.ip.limit();
  const store = getRateLimitStore();
  const ip = getClientIp(request);

  const ipResult = await store.increment(
    buildRateLimitKey(policy.ip.scope, ip),
    windowMs,
    ipLimit,
  );
  if (!ipResult.allowed) {
    return rateLimitedResponse(policy.ip.code, ipLimit, ipResult);
  }

  if (policy.target && opts.target) {
    const targetLimit = opts.targetLimit ?? policy.target.limit();
    const targetResult = await store.increment(
      buildRateLimitKey(policy.target.scope, opts.target),
      windowMs,
      targetLimit,
    );
    if (!targetResult.allowed) {
      return rateLimitedResponse(policy.target.code, targetLimit, targetResult);
    }
  }

  return null;
}
