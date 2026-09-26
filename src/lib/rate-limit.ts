// SPDX-License-Identifier: MIT

/**
 * Consolidated Rate Limiting Module (Issue #759)
 *
 * Single unified rate limiting engine that owns:
 *   1. Store interface & implementations:
 *      • In-memory            (dev / single instance)
 *      • Redis over TCP       (Node runtime — `redis://` / `rediss://` REDIS_URL)
 *      • Redis over HTTP/REST (any runtime, including edge — `https://` REDIS_URL
 *                              or REDIS_REST_URL, Upstash-compatible)
 *   2. Bucket key construction
 *   3. Rate limit header generation (standardized across all callers)
 *   4. Endpoint policies as configuration data
 *   5. Unified enforcement for Proxy (Edge) and Route Handlers (Node)
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
 */

import { ERROR_CODES } from "./error-codes";

// ── Store Interface & Types ────────────────────────────────────

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
   * @param key          Unique identifier (e.g. bucket key)
   * @param windowMs     Sliding-window duration in milliseconds
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

// ── Singleton Store Lifecycle ──────────────────────────────────

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

// ── Bucket-Key Builder ─────────────────────────────────────────

export type RateLimitBucketType = "ip" | "wallet" | "addr" | "global" | string;

/**
 * Builds standard, collision-free bucket keys for rate limiting.
 * Format: `<namespace>:<type>:<identifier>` or `<namespace>:<identifier>`
 */
export function buildBucketKey(
  namespace: string,
  typeOrId: string,
  identifier?: string
): string {
  if (identifier === undefined) {
    return `${namespace}:${typeOrId}`;
  }
  return `${namespace}:${typeOrId}:${identifier}`;
}

// ── Header Writer ──────────────────────────────────────────────

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

export function getRetryAfterSeconds(result: RateLimitResult): number {
  return Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
}

/**
 * Standardized header writer for all rate-limit responses (proxy, auth, lookup).
 * Produces consistent Retry-After, X-RateLimit-*, and security headers.
 */
export function writeRateLimitHeaders(
  info: RateLimitInfo,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const retryAfterSec = info.remaining <= 0 ? Math.max(1, info.reset - nowSec) : 0;

  return {
    "X-RateLimit-Limit": String(info.limit),
    "X-RateLimit-Remaining": String(Math.max(0, info.remaining)),
    "X-RateLimit-Reset": String(info.reset),
    "Retry-After": String(retryAfterSec),
    "X-Content-Type-Options": "nosniff",
    ...(extraHeaders ?? {}),
  };
}

/**
 * Backward-compatible helper for legacy rate-limit header tests.
 */
export function getRateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  return {
    "X-RateLimit-Limit": info.limit.toString(),
    "X-RateLimit-Remaining": info.remaining.toString(),
    "X-RateLimit-Reset": info.reset.toString(),
    "Retry-After": info.remaining <= 0 ? Math.max(0, info.reset - Math.floor(Date.now() / 1000)).toString() : "0",
  };
}

export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0 && Math.floor(Date.now() / 1000) < info.reset;
}

// ── Endpoint Policies as Data ──────────────────────────────────

export interface RateLimitPolicy {
  /** Policy identifier / namespace */
  name: string;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Default per-IP request limit per window */
  ipLimit: number;
  /** Environment variable name to override ipLimit */
  ipLimitEnv?: string;
  /** Optional target limit (e.g. per-wallet or per-address limit) */
  targetLimit?: number;
  /** Environment variable name to override targetLimit */
  targetLimitEnv?: string;
  /** Type of target identifier ("wallet" | "addr") */
  targetType?: "wallet" | "addr";
  /** Error code on IP rate limit */
  ipErrorCode?: string;
  /** Error code on target rate limit */
  targetErrorCode?: string;
  /** User-facing message */
  errorMessage?: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export const RATE_LIMIT_POLICIES = {
  PROXY: {
    name: "proxy",
    windowMs: 60_000,
    ipLimit: 120,
    ipLimitEnv: "RATE_LIMIT_RPM",
    ipErrorCode: ERROR_CODES.RATE_LIMITED,
    errorMessage: "Too many requests. Please try again later.",
  },
  AUTH: {
    name: "auth",
    windowMs: 60_000,
    ipLimit: 30,
    ipLimitEnv: "AUTH_RATE_LIMIT_IP_RPM",
    targetLimit: 10,
    targetLimitEnv: "AUTH_RATE_LIMIT_WALLET_RPM",
    targetType: "wallet",
    ipErrorCode: ERROR_CODES.RATE_LIMIT_IP,
    targetErrorCode: ERROR_CODES.RATE_LIMIT_WALLET,
    errorMessage: "Too many requests. Please try again later.",
  },
  LOOKUP: {
    name: "lookup",
    windowMs: 60_000,
    ipLimit: 60,
    ipLimitEnv: "LOOKUP_RATE_LIMIT_IP_RPM",
    targetLimit: 30,
    targetLimitEnv: "LOOKUP_RATE_LIMIT_ADDR_RPM",
    targetType: "addr",
    ipErrorCode: ERROR_CODES.RATE_LIMIT_IP,
    targetErrorCode: ERROR_CODES.RATE_LIMIT_WALLET,
    errorMessage: "Too many lookup requests. Please try again later.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

// ── Unified Enforcement Engine ─────────────────────────────────

export interface RateLimitOptions {
  windowMs?: number;
  ipLimit?: number;
  targetLimit?: number;
  walletLimit?: number;
  addressLimit?: number;
  target?: string;
}

export function createRateLimitResponse(
  code: string,
  message: string,
  info: RateLimitInfo,
  extraHeaders?: Record<string, string>
): Response {
  const headers = writeRateLimitHeaders(info, extraHeaders);
  return Response.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    {
      status: 429,
      headers,
    }
  );
}

/**
 * Enforce a rate limit policy against an incoming HTTP Request.
 * Returns a 429 Response if throttled, or null if allowed.
 */
export async function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  options: RateLimitOptions = {}
): Promise<Response | null> {
  const windowMs = options.windowMs ?? policy.windowMs;
  const ipLimit =
    options.ipLimit ??
    (policy.ipLimitEnv ? envInt(policy.ipLimitEnv, policy.ipLimit) : policy.ipLimit);
  const targetLimit =
    options.targetLimit ??
    options.walletLimit ??
    options.addressLimit ??
    (policy.targetLimitEnv && policy.targetLimit
      ? envInt(policy.targetLimitEnv, policy.targetLimit)
      : policy.targetLimit);

  const store = getRateLimitStore();
  const ip = getClientIp(request);

  // 1. Per-IP bucket
  const ipKey = buildBucketKey(policy.name, "ip", ip);
  const ipResult = await store.increment(ipKey, windowMs, ipLimit);

  if (!ipResult.allowed) {
    const info: RateLimitInfo = {
      limit: ipLimit,
      remaining: 0,
      reset: Math.ceil(ipResult.resetAt / 1000),
    };
    return createRateLimitResponse(
      policy.ipErrorCode ?? ERROR_CODES.RATE_LIMITED,
      policy.errorMessage ?? "Too many requests. Please try again later.",
      info
    );
  }

  // 2. Per-target bucket (e.g. per-wallet or per-address)
  if (options.target && targetLimit && policy.targetType) {
    const targetKey = buildBucketKey(policy.name, policy.targetType, options.target);
    const targetResult = await store.increment(targetKey, windowMs, targetLimit);

    if (!targetResult.allowed) {
      const info: RateLimitInfo = {
        limit: targetLimit,
        remaining: 0,
        reset: Math.ceil(targetResult.resetAt / 1000),
      };
      return createRateLimitResponse(
        policy.targetErrorCode ?? policy.ipErrorCode ?? ERROR_CODES.RATE_LIMITED,
        policy.errorMessage ?? "Too many requests. Please try again later.",
        info
      );
    }
  }

  return null;
}

// ── Specific Policy Helpers (Drop-in compatibility) ────────────

export interface AuthRateLimitConfig {
  windowMs?: number;
  ipLimit?: number;
  walletLimit?: number;
}

export interface AuthRateLimitOptions extends AuthRateLimitConfig {
  publicKey?: string;
}

export async function enforceAuthRateLimit(
  request: Request,
  opts: AuthRateLimitOptions = {}
): Promise<Response | null> {
  return enforceRateLimit(request, RATE_LIMIT_POLICIES.AUTH, {
    windowMs: opts.windowMs,
    ipLimit: opts.ipLimit,
    targetLimit: opts.walletLimit,
    target: opts.publicKey,
  });
}

export interface LookupRateLimitConfig {
  windowMs?: number;
  ipLimit?: number;
  addressLimit?: number;
}

export interface LookupRateLimitOptions extends LookupRateLimitConfig {
  address?: string;
}

export async function enforceLookupRateLimit(
  request: Request,
  opts: LookupRateLimitOptions = {}
): Promise<Response | null> {
  return enforceRateLimit(request, RATE_LIMIT_POLICIES.LOOKUP, {
    windowMs: opts.windowMs,
    ipLimit: opts.ipLimit,
    targetLimit: opts.addressLimit,
    target: opts.address,
  });
}
