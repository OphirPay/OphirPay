// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { replayAllDeadLetters, replayDeadLetter } from '@/lib/webhook-dead-letter-service';
import { resolveActiveWebhookTarget } from '@/lib/webhook-target-resolver';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/[id]/dead-letters/replay
 *
 * Replay dead-lettered deliveries for a single webhook.
 * Body: { deadLetterId?: string }  — omit to bulk-replay (oldest first, max 50).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const webhookId = params.id;
    const body = await request.json().catch(() => ({} as { deadLetterId?: string }));
    const deadLetterId = typeof body?.deadLetterId === 'string' ? body.deadLetterId : undefined;

    if (deadLetterId) {
      const outcome = await replayDeadLetter(deadLetterId, resolveActiveWebhookTarget);
      return NextResponse.json({ outcome }, { status: outcome.ok ? 200 : 502 });
    }

    const outcomes = await replayAllDeadLetters(webhookId, resolveActiveWebhookTarget);
    const succeeded = outcomes.filter((o) => o.ok).length;
    return NextResponse.json({ outcomes, succeeded, attempted: outcomes.length });
  } catch (error) {
    logger.error('Failed to replay webhook dead letters', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
