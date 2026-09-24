import { NextResponse } from 'next/server';
import { getOrSetCache } from '@/src/lib/api-cache';
import { listContracts } from '@/src/server/contracts'; // adjust import path

const CACHE_KEY = 'api:contracts';
const CACHE_TTL = 30; // contracts list changes rarely

export async function GET(request: Request) {
  const data = await getOrSetCache(CACHE_KEY, CACHE_TTL, async () => {
    return await listContracts();
  });

  const headers = {
    'Cache-Control': `private, max-age=${CACHE_TTL}, stale-while-revalidate=60`,
  };

  return NextResponse.json(data, { headers });
}
