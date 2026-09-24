import { NextResponse } from 'next/server';
import { updateFeeConfig } from '@/src/server/fees'; // adjust import
import { invalidateCachePrefixes } from '@/src/lib/api-cache';

export async function PATCH(request: Request) {
  const payload = await request.json();

  const updated = await updateFeeConfig(payload);

  // Fee config changes affect stats & analytics.
  await invalidateCachePrefixes(['api:stats', 'api:analytics']);

  const headers = {
    'Cache-Control': 'no-store',
  };

  return NextResponse.json(updated, { headers });
}
