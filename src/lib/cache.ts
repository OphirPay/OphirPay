// SPDX-License-Identifier: MIT

/**
 * Cache-control header utilities for API and static responses.
 */

interface CacheConfig {
  maxAge?: number;
  staleWhileRevalidate?: number;
  immutable?: boolean;
  isPrivate?: boolean;
}

/**
 * Generate a Cache-Control header value for API responses.
 */
export function cacheControl(config: CacheConfig = {}): string {
  const {
    maxAge = 0,
    staleWhileRevalidate,
    immutable = false,
    isPrivate = false,
  } = config;

  const directives: string[] = [];

  if (isPrivate) {
    directives.push("private");
  } else {
    directives.push("public");
  }

  directives.push(`max-age=${maxAge}`);

  if (staleWhileRevalidate) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }

  if (immutable) {
    directives.push("immutable");
  }

  if (maxAge === 0) {
    return "no-cache, no-store, must-revalidate";
  }

  return directives.join(", ");
}

// ── Server-side cached reads (#741) ───────────────────────────

/**
 * `Cache-Control` for a response served from the server-side read cache.
 *
 * Always `private` + `no-store`: these payloads are authenticated and derived
 * from live financial state, so no browser or shared intermediary may replay
 * one. The server-side cache (src/lib/api-cache.ts) is the only caching layer
 * allowed to serve them, and only for the length of its TTL.
 */
export const READ_CACHE_CONTROL = "private, no-cache, no-store, must-revalidate";

/**
 * Headers for a cached read-only endpoint response.
 *
 * `X-Cache-Status` makes the server-side cache observable in production
 * (`HIT` = served from L1/L2, `MISS` = the loader ran) and is what the
 * performance baseline in docs/PERFORMANCE.md is measured with.
 */
export function readCacheHeaders(status: "HIT" | "MISS"): Record<string, string> {
  return {
    "Cache-Control": READ_CACHE_CONTROL,
    "X-Cache-Status": status,
  };
}

/**
 * Standard cache settings for different response types.
 */
export const CACHE_PRESETS = {
  /** Dynamic data — never cache (default for API) */
  dynamic: "no-cache, no-store, must-revalidate",
  /** Semi-static data — cache for 1 minute, stale for 5 */
  short: "public, max-age=60, stale-while-revalidate=300",
  /** Static data — cache for 1 hour */
  long: "public, max-age=3600, stale-while-revalidate=86400",
  /** Immutable assets (fingerprinted files) */
  immutable: "public, max-age=31536000, immutable",
} as const;
