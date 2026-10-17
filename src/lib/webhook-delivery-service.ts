// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { deliverWebhook, type WebhookDeliveryResult } from "@/lib/webhook-deliver";
import { recordWebhookDelivery, toWebhookPayload } from "@/lib/webhook-event-store";

/**
 * Exponential backoff schedule for failed webhook deliveries (#1288):
 * 1m → 5m → 15m → 1h → 4h
 */
export const WEBHOOK_BACKOFF_SCHEDULE_MS = [
  60_000, // 1 minute
  5 * 60_000, // 5 minutes
  15 * 60_000, // 15 minutes
  60 * 60_000, // 1 hour
  4 * 60 * 60_000, // 4 hours
] as const;

export const MAX_WEBHOOK_RETRY_ATTEMPTS = WEBHOOK_BACKOFF_SCHEDULE_MS.length;

export interface RecordDeliveryOptions {
  responseCode?: number;
  isReplay?: boolean;
  replayBatchId?: string;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
}

export interface RetryQueueEntryResult {
  id: string;
  status: "SUCCESS" | "FAILED" | "DEAD_LETTER";
  retryState: "DELIVERED" | "RETRYING" | "DEAD_LETTER";
  attempts: number;
  nextAttemptAt: Date | null;
}

export interface WebhookRetryRunSummary {
  picked: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  results: RetryQueueEntryResult[];
}

/**
 * Return the backoff delay in milliseconds for the given 1-based attempt number,
 * or `null` once `MAX_WEBHOOK_RETRY_ATTEMPTS` has been reached.
 */
export function getNextWebhookRetryDelayMs(
  attempt: number,
  maxAttempts: number = MAX_WEBHOOK_RETRY_ATTEMPTS,
): number | null {
  if (attempt < 1 || attempt >= maxAttempts) {
    return null;
  }
  const index = Math.min(attempt - 1, WEBHOOK_BACKOFF_SCHEDULE_MS.length - 1);
  return WEBHOOK_BACKOFF_SCHEDULE_MS[index] ?? null;
}

/**
 * Compute the timestamp for the next retry attempt given the current attempt
 * count and base timestamp, or `null` when retries are exhausted.
 */
export function computeNextWebhookRetryAt(
  attempt: number,
  baseTime: Date = new Date(),
  maxAttempts: number = MAX_WEBHOOK_RETRY_ATTEMPTS,
): Date | null {
  const delayMs = getNextWebhookRetryDelayMs(attempt, maxAttempts);
  if (delayMs === null) {
    return null;
  }
  return new Date(baseTime.getTime() + delayMs);
}

/** Map deliverWebhook output into a delivery ledger row. */
export async function persistDeliveryResult(
  webhookId: string,
  eventId: string,
  result: WebhookDeliveryResult,
  options?: Omit<RecordDeliveryOptions, "responseCode" | "latencyMs" | "attempts" | "errorMessage">,
): Promise<string> {
  return recordWebhookDelivery(
    webhookId,
    eventId,
    result.success ? "SUCCESS" : "DEAD_LETTER",
    {
      responseCode: result.statusCode,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      errorMessage: result.errorMessage,
      ...options,
    },
  );
}

/**
 * Record a webhook delivery attempt with exponential-backoff retry scheduling.
 * Failed deliveries with remaining attempts are persisted with `FAILED` status
 * (active `RETRYING` queue state) and promoted to `DEAD_LETTER` once max
 * retries are exhausted.
 */
export async function enqueueWebhookRetry(
  webhookId: string,
  eventId: string,
  result: WebhookDeliveryResult,
  options?: {
    maxAttempts?: number;
    now?: Date;
    isReplay?: boolean;
    replayBatchId?: string;
  },
): Promise<RetryQueueEntryResult> {
  const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_RETRY_ATTEMPTS;
  const now = options?.now ?? new Date();
  const attempts = Math.max(1, result.attempts || 1);

  if (result.success) {
    const id = await recordWebhookDelivery(webhookId, eventId, "SUCCESS", {
      responseCode: result.statusCode,
      latencyMs: result.latencyMs,
      attempts,
      errorMessage: result.errorMessage,
      isReplay: options?.isReplay,
      replayBatchId: options?.replayBatchId,
    });
    return {
      id,
      status: "SUCCESS",
      retryState: "DELIVERED",
      attempts,
      nextAttemptAt: null,
    };
  }

  const nextAttemptAt = computeNextWebhookRetryAt(attempts, now, maxAttempts);
  const exhausted = nextAttemptAt === null;
  const dbStatus = exhausted ? "DEAD_LETTER" : "FAILED";

  const id = await recordWebhookDelivery(webhookId, eventId, dbStatus, {
    responseCode: result.statusCode,
    latencyMs: result.latencyMs,
    attempts,
    errorMessage: result.errorMessage,
    isReplay: options?.isReplay,
    replayBatchId: options?.replayBatchId,
  });

  return {
    id,
    status: dbStatus,
    retryState: exhausted ? "DEAD_LETTER" : "RETRYING",
    attempts,
    nextAttemptAt,
  };
}

/**
 * Process due failed webhook deliveries in the exponential-backoff retry queue.
 */
export async function processWebhookRetryQueue(options?: {
  now?: Date;
  limit?: number;
  maxAttempts?: number;
}): Promise<WebhookRetryRunSummary> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 50;
  const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_RETRY_ATTEMPTS;

  const candidates = await prisma.webhookDelivery.findMany({
    where: {
      status: "FAILED",
      attempts: { lt: maxAttempts },
    },
    orderBy: { deliveredAt: "asc" },
    take: limit,
    include: {
      webhook: true,
      event: true,
    },
  });

  const due = candidates.filter((row) => {
    if (!row.webhook?.isActive) return false;
    const baseTime = row.deliveredAt ?? row.createdAt ?? now;
    const nextAt = computeNextWebhookRetryAt(row.attempts, baseTime, maxAttempts);
    return nextAt !== null && nextAt.getTime() <= now.getTime();
  });

  const summary: WebhookRetryRunSummary = {
    picked: due.length,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    results: [],
  };

  for (const row of due) {
    const nextAttempt = row.attempts + 1;
    const payload = toWebhookPayload(row.event);
    const deliveryResult = await deliverWebhook(
      row.webhook.url,
      row.webhook.secret,
      payload,
      1,
    );

    if (deliveryResult.success) {
      await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: {
          status: "SUCCESS",
          attempts: nextAttempt,
          responseCode: deliveryResult.statusCode,
          latencyMs: deliveryResult.latencyMs,
          errorMessage: null,
          deliveredAt: now,
        },
      });
      summary.succeeded += 1;
      summary.results.push({
        id: row.id,
        status: "SUCCESS",
        retryState: "DELIVERED",
        attempts: nextAttempt,
        nextAttemptAt: null,
      });
      continue;
    }

    const nextAttemptAt = computeNextWebhookRetryAt(nextAttempt, now, maxAttempts);
    const exhausted = nextAttemptAt === null;
    const nextStatus = exhausted ? "DEAD_LETTER" : "FAILED";

    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        attempts: nextAttempt,
        responseCode: deliveryResult.statusCode,
        latencyMs: deliveryResult.latencyMs,
        errorMessage: deliveryResult.errorMessage ?? "Delivery failed",
        deliveredAt: now,
      },
    });

    if (exhausted) {
      summary.deadLettered += 1;
    } else {
      summary.retried += 1;
    }

    summary.results.push({
      id: row.id,
      status: nextStatus,
      retryState: exhausted ? "DEAD_LETTER" : "RETRYING",
      attempts: nextAttempt,
      nextAttemptAt,
    });
  }

  return summary;
}

export { toWebhookPayload, deliverWebhook };
export type { WebhookDeliveryResult };
