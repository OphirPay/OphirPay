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

export interface RateLimitTelemetry {
  limit: number;
  remaining: number;
  resetAt: number; // Unix epoch timestamp (milliseconds or seconds)
  allowed?: boolean;
}

/**
 * Generate standard rate limit response headers (backward-compatible legacy interface).
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
 * Create standard rate limit telemetry headers (X-RateLimit-Limit, X-RateLimit-Remaining,
 * X-RateLimit-Reset, and Retry-After for exhausted / rate-limited requests).
 */
export function createRateLimitHeaders(telemetry: RateLimitTelemetry): Record<string, string> {
  const isMillis = telemetry.resetAt > 1e11;
  const resetSeconds = isMillis
    ? Math.ceil(telemetry.resetAt / 1000)
    : Math.ceil(telemetry.resetAt);
  const remaining = Math.max(0, telemetry.remaining);
  const isExhausted = telemetry.allowed === false || remaining === 0;

  const retryAfter = Math.max(
    1,
    isMillis
      ? Math.ceil((telemetry.resetAt - Date.now()) / 1000)
      : Math.ceil(telemetry.resetAt - Math.floor(Date.now() / 1000))
  );

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(telemetry.limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetSeconds),
  };

  if (isExhausted) {
    headers["Retry-After"] = String(retryAfter);
  }

  return headers;
}

/**
 * Apply rate limit headers directly onto a Headers object or Response headers.
 */
export function applyRateLimitHeaders(
  target: Headers,
  telemetry: RateLimitTelemetry
): void {
  const headers = createRateLimitHeaders(telemetry);
  for (const [key, value] of Object.entries(headers)) {
    target.set(key, value);
  }
}

/**
 * Check if the current request has exceeded rate limits.
 */
export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0 && Math.floor(Date.now() / 1000) < info.reset;
}

