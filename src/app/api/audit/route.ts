import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/src/server/audit'; // adjust import
import { invalidateCachePrefixes } from '@/src/lib/api-cache';

export async function POST(request: Request) {
  const entry = await request.json();

  const saved = await writeAuditLog(entry);

  // Audit reads may be served via `/api/contracts` or other read‑only endpoints.
  await invalidateCachePrefixes(['api:contracts']);

  const headers = {
    'Cache-Control': 'no-store',
  };

  return NextResponse.json(saved, { headers });
}
