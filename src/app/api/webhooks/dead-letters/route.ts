// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { countDeadLetters, listDeadLetters } from '@/lib/webhook-dead-letter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/webhooks/dead-letters
 *
 * List dead-lettered webhook deliveries across all webhooks (newest first).
 * Query params: ?webhookId=&limit=&cursor=&includeReplayed=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const webhookId = searchParams.get('webhookId') ?? undefined;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const cursor = searchParams.get('cursor');
    const includeReplayed = searchParams.get('includeReplayed') === 'true';

    if (limitRaw && (Number.isNaN(limit) || limit < 1)) {
      return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
    }

    const [items, total] = await Promise.all([
      listDeadLetters({ webhookId, limit, cursor, includeReplayed }),
      countDeadLetters(webhookId),
    ]);

    return NextResponse.json({
      items,
      total,
      nextCursor: items.length === Math.min(Math.max(limit, 1), 200) ? items[items.length - 1].id : null,
    });
  } catch (error) {
    logger.error('Failed to list webhook dead letters', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
