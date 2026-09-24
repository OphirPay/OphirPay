import { NextResponse } from 'next/server';
import { getOrSetCache } from '@/src/lib/api-cache';
import { getAnalytics } from '@/src/server/analytics'; // adjust as needed

const CACHE_KEY = 'api:analytics';
const CACHE_TTL = 30; // 30 seconds is sufficient for dashboard refreshes

export async function GET(request: Request) {
  const data = await getOrSetCache(CACHE_KEY, CACHE_TTL, async () => {
    return await getAnalytics();
  });

  const headers = {
    'Cache-Control': `private, max-age=${CACHE_TTL}, stale-while-revalidate=60`,
  };

  return NextResponse.json(data, { headers });
}
