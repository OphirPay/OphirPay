// SPDX-License-Identifier: MIT

/**
 * Rate limit header generation for API responses.
 * Follows IETF draft for RateLimit headers and X-RateLimit-* conventions.
 */

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

/**
 * Generate standard rate limit response headers.
 */
export function getRateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  return {
    "X-RateLimit-Limit": info.limit.toString(),
    "X-RateLimit-Remaining": info.remaining.toString(),
    "X-RateLimit-Reset": info.reset.toString(),
    "Retry-After": info.remaining <= 0 ? Math.max(0, info.reset - Math.floor(Date.now() / 1000)).toString() : "0",
  };
}

/**
 * Check if the current request has exceeded rate limits.
 */
export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0 && Math.floor(Date.now() / 1000) < info.reset;
}
