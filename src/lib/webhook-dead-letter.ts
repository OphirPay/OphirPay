// SPDX-License-Identifier: MIT

/**
 * Dead-letter queue for outgoing webhook deliveries.
 *
 * A delivery that exhausts `RETRY_CONFIG.webhook.maxAttempts` is moved into the
 * dead-letter table instead of being silently dropped. Operators can list dead
 * letters, retry a single entry, or bulk-replay a webhook's dead letters.
 */

import prisma from '@/lib/prisma';
import { RETRY_CONFIG } from '@/lib/retry-config';

export interface DeadLetterInput {
  webhookId: string;
  deliveryId: string;
  eventId: string;
  payload: string;
  attempts: number;
  lastResponseCode?: number | null;
  lastErrorMessage?: string | null;
}

export interface DeadLetterListOptions {
  webhookId?: string;
  limit?: number;
  cursor?: string | null;
  includeReplayed?: boolean;
}

/** Whether a delivery has exhausted its retry budget and must be dead-lettered. */
export function shouldDeadLetter(
  attempts: number,
  maxAttempts = RETRY_CONFIG.webhook.maxAttempts,
): boolean {
  return attempts >= maxAttempts;
}

/**
 * Move an exhausted delivery into the dead-letter queue.
 * Idempotent: a duplicate (deliveryId) is updated rather than duplicated.
 */
export async function moveToDeadLetter(input: DeadLetterInput) {
  return prisma.webhookDeadLetter.upsert({
    where: { deliveryId: input.deliveryId },
    create: {
      webhookId: input.webhookId,
      deliveryId: input.deliveryId,
      eventId: input.eventId,
      payload: input.payload,
      attempts: input.attempts,
      lastResponseCode: input.lastResponseCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
    },
    update: {
      attempts: input.attempts,
      lastResponseCode: input.lastResponseCode ?? null,
      lastErrorMessage: input.lastErrorMessage ?? null,
    },
  });
}

/** Page through dead letters, newest first. */
export async function listDeadLetters(options: DeadLetterListOptions = {}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return prisma.webhookDeadLetter.findMany({
    where: {
      ...(options.webhookId ? { webhookId: options.webhookId } : {}),
      ...(options.includeReplayed ? {} : { replayedAt: null }),
    },
    orderBy: { failedAt: 'desc' },
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

/** Mark a dead letter as replayed and link it to the replacement delivery. */
export async function markDeadLetterReplayed(deadLetterId: string, replayDeliveryId: string) {
  return prisma.webhookDeadLetter.update({
    where: { id: deadLetterId },
    data: { replayedAt: new Date(), replayDeliveryId },
  });
}

/** Count of un-replayed dead letters, optionally scoped to one webhook. */
export async function countDeadLetters(webhookId?: string): Promise<number> {
  return prisma.webhookDeadLetter.count({
    where: { replayedAt: null, ...(webhookId ? { webhookId } : {}) },
  });
}
