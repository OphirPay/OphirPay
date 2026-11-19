// SPDX-License-Identifier: MIT

/**
 * Rate limit header generation for API responses.
 *
 * Follows the widely-adopted `X-RateLimit-*` convention (and the IETF
 * RateLimit draft's semantics): every response advertises the window's limit,
 * remaining quota and reset time, while a 429 additionally carries
 * `Retry-After` so SDKs can implement adaptive throttling without parsing the
 * reset timestamp themselves.
 */

import type { RateLimitResult } from "@/lib/rate-limit";

export interface RateLimitInfo {
  /** Maximum requests allowed in the current window. */
  limit: number;
  /** Requests remaining in the current window (floored at 0). */
  remaining: number;
  /** Unix timestamp in **seconds** when the window resets. */
  reset: number;
}

/**
 * Headers for any response — successful or not — that consumed quota.
 *
 * `Retry-After` is deliberately absent: it only has meaning on a throttled
 * response, where {@link getRateLimitExceededHeaders} adds it.
 */
export function getRateLimitHeaders(
  info: RateLimitInfo
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(info.limit),
    "X-RateLimit-Remaining": String(Math.max(0, info.remaining)),
    "X-RateLimit-Reset": String(info.reset),
  };
}

/** Seconds a caller should wait before retrying (never negative). */
export function getRetryAfterHeaderValue(
  info: RateLimitInfo,
  nowMs: number = Date.now()
): number {
  return Math.max(0, Math.ceil(info.reset - nowMs / 1000));
}

/**
 * Headers for a 429 response: the standard quota headers plus `Retry-After`.
 */
export function getRateLimitExceededHeaders(
  info: RateLimitInfo,
  nowMs: number = Date.now()
): Record<string, string> {
  return {
    ...getRateLimitHeaders(info),
    "Retry-After": String(getRetryAfterHeaderValue(info, nowMs)),
  };
}

/** Convert a store result into the seconds-based header shape. */
export function rateLimitInfoFromResult(
  result: RateLimitResult
): RateLimitInfo {
  return {
    limit: result.limit,
    remaining: result.remaining,
    reset: Math.ceil(result.resetAt / 1000),
  };
}

/**
 * Check if the current request has exceeded rate limits.
 */
export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0 && Math.floor(Date.now() / 1000) < info.reset;
}
