// SPDX-License-Identifier: MIT

/**
 * Simple in-memory TTL cache for read-only contract simulations.
 * Reduces RPC load by caching get_stats, get_audit_log_count, get_proposal_count, etc.
 *
 * In production, replace with Redis for multi-replica consistency.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Default TTL: 30 seconds for stats, 5 seconds for audit counts */
const DEFAULT_TTL_MS = 30_000;

/**
 * Get a cached value by key. Returns undefined if miss or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

/**
 * Set a cached value with TTL in milliseconds.
 */
export function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Delete a specific cache key.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
}

/**
 * Clear all cached entries.
 */
export function cacheClear(): void {
  store.clear();
}

/**
 * Get cache stats for monitoring.
 */
export function cacheStats(): { size: number; keys: string[] } {
  // Purge expired entries before reporting
  for (const [key, entry] of store) {
    if (Date.now() > entry.expiresAt) store.delete(key);
  }
  return { size: store.size, keys: Array.from(store.keys()) };
}

/**
 * Fetch with cache: wraps an async function with a TTL cache.
 * On cache hit, returns cached value. On miss, calls fn and caches result.
 */
export async function cachedFetch<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = cacheGet<T>(cacheKey);
  if (cached !== undefined) return cached;

  const data = await fn();
  cacheSet(cacheKey, data, ttlMs);
  return data;
}
