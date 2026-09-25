// SPDX-License-Identifier: MIT

/**
 * Consolidated Rate Limiting Module (Issue #759)
 *
 * Single unified rate limiting engine that owns:
 *   1. Store interface & implementations (InMemory, Redis)
 *   2. Bucket key construction
 *   3. Rate limit header generation (standardized across all callers)
 *   4. Endpoint policies as configuration data
 *   5. Unified enforcement for Proxy (Edge) and Route Handlers (Node)
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

// ── Redis Store ────────────────────────────────────────────────

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

// ── Singleton Store Lifecycle ──────────────────────────────────

let _store: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (!_store) {
    _store = new InMemoryRateLimitStore();
  }
  return _store;
}

export function setRateLimitStore(store: RateLimitStore): void {
  _store = store;
}

export async function initRateLimitStore(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Dynamic import — ioredis is an optional peer dependency.
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
    } catch (err) {
      console.warn(
        "[rate-limit] Redis unavailable — falling back to in-memory store.",
        String(err)
      );
      _store = new InMemoryRateLimitStore();
    }
  } else {
    _store = new InMemoryRateLimitStore();
  }
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
