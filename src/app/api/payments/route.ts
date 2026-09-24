import { NextResponse } from 'next/server';
import { createPayment } from '@/src/server/payments'; // adjust import
import { invalidateCachePrefixes } from '@/src/lib/api-cache';

/**
 * POST /api/payments
 *
 * Creates a new payment. After a successful creation we invalidate any cached
 * read‑only endpoints that could be affected by the new payment.
 */
export async function POST(request: Request) {
  const payload = await request.json();

  const result = await createPayment(payload);

  // Invalidate caches that depend on payment data.
  await invalidateCachePrefixes(['api:stats', 'api:analytics', 'api:contracts']);

  const headers = {
    // No public caching for mutation responses.
    'Cache-Control': 'no-store',
  };

  return NextResponse.json(result, { status: 201, headers });
}
