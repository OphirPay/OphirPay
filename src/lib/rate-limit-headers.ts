// SPDX-License-Identifier: MIT
//
// Rate limit header helpers.
//
// The header formatting itself lives in `src/lib/rate-limit.ts`
// (`formatRateLimitHeaders`), the single writer shared by the edge proxy, the
// auth/lookup 429 builders and this module (issue #759). This file keeps the
// IETF-style `RateLimitInfo` convenience API for callers that already have a
// `{ limit, remaining, reset }` tuple.

import { formatRateLimitHeaders } from "@/lib/rate-limit";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

/**
 * Generate standard rate limit response headers.
 */
export function getRateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  return formatRateLimitHeaders({
    limit: info.limit,
    remaining: info.remaining,
    resetAt: info.reset * 1000,
  });
}

/**
 * Check if the current request has exceeded rate limits.
 */
export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0 && Math.floor(Date.now() / 1000) < info.reset;
}
