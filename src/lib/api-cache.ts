/**
 * Helper utilities that sit on top of `src/lib/cache.ts` and make it easy to
 * cache whole API responses.
 *
 * The functions are deliberately framework‑agnostic – they only deal with plain
 * JavaScript objects. The route handlers are responsible for turning those
 * objects into `NextResponse` (or `NextApiResponse` for the pages router).
 */

import { cache } from '@/src/lib/cache';

/**
 * Retrieve a value from the cache or compute it via `fetcher`.
 *
 * The result is cached as JSON using the supplied `ttlSeconds`.
 *
 * @param key        Unique cache key (e.g. `api:stats`).
 * @param ttlSeconds Time‑to‑live in seconds.
 * @param fetcher    Async function that returns the fresh data.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // If JSON parsing fails we fall back to recomputing.
    }
  }

  const fresh = await fetcher();
  await cache.set(key, JSON.stringify(fresh), ttlSeconds);
  return fresh;
}

/**
 * Convenience wrapper for mutation endpoints that need to purge related
 * read‑only caches.
 *
 * Pass an array of prefixes (e.g. `['api:stats', 'api:analytics']`) that should
 * be invalidated after the mutation succeeds.
 */
export async function invalidateCachePrefixes(prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    await cache.invalidatePrefix(prefix);
  }
}
