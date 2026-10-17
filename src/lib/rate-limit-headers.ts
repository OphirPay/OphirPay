// SPDX-License-Identifier: MIT

/**
 * Standard RFC / IETF rate-limit telemetry header helpers (#1290).
 *
 * Populates `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`,
 * and `Retry-After` on API responses so SDK integrators and webhook consumers
 * can implement adaptive client-side throttling.
 */

import { getRateLimitStore, type RateLimitResult } from "@/lib/rate-limit";
import { ERROR_CODES } from "@/lib/error-codes";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** Unix epoch timestamp in seconds when the window resets. */
  reset: number;
}

export type RateLimitState = RateLimitInfo;

/**
 * Generate standard rate limit response headers.
 */
export function getRateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const retryAfter =
    info.remaining <= 0 ? Math.max(0, info.reset - nowSec) : 0;

  return {
    "X-RateLimit-Limit": String(info.limit),
    "X-RateLimit-Remaining": String(Math.max(0, info.remaining)),
    "X-RateLimit-Reset": String(info.reset),
    "Retry-After": String(retryAfter),
  };
}

/**
 * Determine whether the rate-limit window is currently exhausted.
 */
export function isRateLimited(info: RateLimitInfo): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return info.remaining <= 0 && info.reset > nowSec;
}

export interface RateLimitHeadersOptions {
  /** Override current timestamp in ms (for deterministic tests). */
  now?: number;
}

export interface RateLimitedResponseOptions extends RateLimitHeadersOptions {
  /** Application error code (defaults to `RATE_LIMITED`). */
  code?: string;
  /** Human-readable error message. */
  message?: string;
}

export interface RateLimitTelemetryConfig {
  /** Explicit rate-limit bucket key (defaults to client IP). */
  key?: string;
  /** Sliding window duration in ms (defaults to 60_000). */
  windowMs?: number;
  /** Maximum requests allowed in the window (defaults to RATE_LIMIT_RPM or 120). */
  limit?: number;
  /** Optional clock override in ms (tests). */
  now?: number;
}

/**
 * Compute standard `X-RateLimit-*` and (on 429) `Retry-After` header key-value
 * pairs from a `RateLimitResult`.
 */
export function buildRateLimitHeaders(
  result: RateLimitResult,
  limit?: number,
  options: RateLimitHeadersOptions = {}
): Record<string, string> {
  const resolvedLimit = limit ?? result.limit ?? 120;
  const now = options.now ?? Date.now();
  const remaining = result.allowed ? Math.max(0, result.remaining) : 0;
  const resetEpochSeconds = Math.max(0, Math.ceil(result.resetAt / 1000));

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(resolvedLimit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetEpochSeconds),
  };

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - now) / 1000));
    headers["Retry-After"] = String(retryAfterSeconds);
  }

  return headers;
}

/**
 * Attach `X-RateLimit-*` telemetry headers (and `Retry-After` when throttled)
 * to an existing `Response`.
 */
export function applyRateLimitHeaders(
  response: Response,
  result: RateLimitResult,
  limit?: number,
  options: RateLimitHeadersOptions = {}
): Response {
  const telemetry = buildRateLimitHeaders(result, limit, options);
  try {
    for (const [key, value] of Object.entries(telemetry)) {
      response.headers.set(key, value);
    }
    return response;
  } catch {
    const mergedHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(telemetry)) {
      mergedHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergedHeaders,
    });
  }
}

/**
 * Build a standardized HTTP 429 Too Many Requests response carrying
 * `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, and
 * `X-RateLimit-Reset`.
 */
export function createRateLimitedResponse(
  result: RateLimitResult,
  limit?: number,
  options: RateLimitedResponseOptions = {}
): Response {
  const code = options.code ?? ERROR_CODES.RATE_LIMITED;
  const message =
    options.message ?? "Too many requests. Please try again later.";
  const telemetryHeaders = buildRateLimitHeaders(
    { ...result, allowed: false, remaining: 0 },
    limit,
    { now: options.now }
  );

  return Response.json(
    {
      success: false,
      error: {
        code,
        message,
      },
      timestamp: new Date(options.now ?? Date.now()).toISOString(),
    },
    {
      status: 429,
      headers: {
        ...telemetryHeaders,
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function extractClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Evaluate the rate-limit bucket for `request` and attach `X-RateLimit-*`
 * telemetry headers to both 2xx responses and 429 rejections.
 */
export async function withRateLimitHeaders(
  request: Request,
  handler: (req: Request) => Promise<Response> | Response,
  config: RateLimitTelemetryConfig = {}
): Promise<Response> {
  const windowMs = config.windowMs ?? 60_000;
  const defaultLimit = Number.parseInt(process.env.RATE_LIMIT_RPM ?? "120", 10);
  const limit =
    config.limit ??
    (Number.isFinite(defaultLimit) && defaultLimit > 0 ? defaultLimit : 120);
  const key = config.key ?? `api:ip:${extractClientIp(request)}`;

  const store = getRateLimitStore();
  const result = await store.increment(key, windowMs, limit);

  if (!result.allowed) {
    return createRateLimitedResponse(result, limit, { now: config.now });
  }

  const response = await handler(request);
  return applyRateLimitHeaders(response, result, limit, { now: config.now });
}
