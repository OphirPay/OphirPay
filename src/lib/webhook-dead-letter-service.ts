// SPDX-License-Identifier: MIT

/**
 * Orchestration layer for the webhook dead-letter queue.
 *
 * Ties together: exhaustion detection (webhook-deliver), persistence
 * (webhook-dead-letter), delivery ledger (webhook-event-store) and replay.
 */

import { logger } from '@/lib/logger';
import { incMetric } from '@/lib/metrics-counters';
import { RETRY_CONFIG } from '@/lib/retry-config';
import {
  countDeadLetters,
  listDeadLetters,
  markDeadLetterReplayed,
  moveToDeadLetter,
  shouldDeadLetter,
  type DeadLetterListOptions,
} from '@/lib/webhook-dead-letter';
import { deliverWebhook, type WebhookDeliveryResult } from '@/lib/webhook-deliver';
import { recordWebhookDelivery } from '@/lib/webhook-event-store';

export interface ExhaustedDelivery {
  webhookId: string;
  deliveryId: string;
  eventId: string;
  payload: string;
  result: WebhookDeliveryResult;
}

/**
 * Record an exhausted delivery in the DLQ. No-op when the delivery still has
 * retry budget left, so this is safe to call unconditionally after a failure.
 */
export async function deadLetterIfExhausted(input: ExhaustedDelivery) {
  if (!shouldDeadLetter(input.result.attempts, RETRY_CONFIG.webhook.maxAttempts)) return null;

  const row = await moveToDeadLetter({
    webhookId: input.webhookId,
    deliveryId: input.deliveryId,
    eventId: input.eventId,
    payload: input.payload,
    attempts: input.result.attempts,
    lastResponseCode: input.result.statusCode ?? null,
    lastErrorMessage: input.result.errorMessage ?? null,
  });

  incMetric('webhooks_dead_lettered_total');
  logger.warn('Webhook delivery moved to dead-letter queue', {
    webhookId: input.webhookId,
    deliveryId: input.deliveryId,
    attempts: input.result.attempts,
  });
  return row;
}

export interface ReplayOutcome {
  deadLetterId: string;
  ok: boolean;
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Replay a single dead-letter entry against its original endpoint.
 * On success the entry is marked replayed and a new ledger row is written.
 */
export async function replayDeadLetter(
  deadLetterId: string,
  secretResolver: (webhookId: string) => Promise<{ url: string; secret: string } | null>,
): Promise<ReplayOutcome> {
  const prisma = (await import('@/lib/prisma')).default;

  const entry = await prisma.webhookDeadLetter.findUnique({ where: { id: deadLetterId } });
  if (!entry) return { deadLetterId, ok: false, errorMessage: 'dead letter not found' };
  if (entry.replayedAt) return { deadLetterId, ok: false, errorMessage: 'already replayed' };

  const target = await secretResolver(entry.webhookId);
  if (!target) return { deadLetterId, ok: false, errorMessage: 'webhook no longer active' };

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(entry.payload) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const payload = { event: entry.eventId, timestamp: entry.failedAt.toISOString(), data: parsed };
  const result = await deliverWebhook(target.url, target.secret, payload);

  const ledgerId = await recordWebhookDelivery(
    entry.webhookId,
    entry.eventId,
    result.success ? 'SUCCESS' : 'FAILED',
    {
      responseCode: result.statusCode,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      errorMessage: result.errorMessage,
      isReplay: true,
    },
  );

  if (result.success) {
    await markDeadLetterReplayed(entry.id, ledgerId);
    incMetric('webhooks_replayed_total');
  }

  return {
    deadLetterId,
    ok: result.success,
    statusCode: result.statusCode,
    errorMessage: result.errorMessage,
  };
}

/** Replay every un-replayed dead letter for one webhook, oldest first. */
export async function replayAllDeadLetters(
  webhookId: string,
  secretResolver: (webhookId: string) => Promise<{ url: string; secret: string } | null>,
  limit = 50,
): Promise<ReplayOutcome[]> {
  const entries = await listDeadLetters({ webhookId, limit });
  const outcomes: ReplayOutcome[] = [];
  for (const entry of entries.slice().reverse()) {
    outcomes.push(await replayDeadLetter(entry.id, secretResolver));
  }
  return outcomes;
}

export { countDeadLetters, listDeadLetters };
export type { DeadLetterListOptions };
