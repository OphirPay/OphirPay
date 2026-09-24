import { NextResponse } from 'next/server';
import { getOrSetCache } from '@/src/lib/api-cache';
import { getStats } from '@/src/server/stats'; // <-- adjust import to actual implementation

// Cache key and TTL (seconds). 30 s gives a noticeable latency drop while keeping data fresh.
const CACHE_KEY = 'api:stats';
const CACHE_TTL = 30;

/**
 * GET /api/stats
 *
 * Returns aggregated statistics about the platform. The result is cached for a
 * short period because the underlying computation is expensive but the data
 * does not need to be real‑time accurate.
 */
export async function GET(request: Request) {
  const data = await getOrSetCache(CACHE_KEY, CACHE_TTL, async () => {
    // Original heavy logic lives in `getStats()`.
    return await getStats();
  });

  // Explicit Cache‑Control header – we allow downstream CDNs to cache for the
  // same TTL but we also set `private` to avoid shared caches storing financial
  // data longer than intended.
  const headers = {
    'Cache-Control': `private, max-age=${CACHE_TTL}, stale-while-revalidate=60`,
  };

  return NextResponse.json(data, { headers });
}
