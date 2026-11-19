// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  deliverWebhook,
  deliveryStatusAfterFailure,
  nextWebhookAttemptAt,
  WEBHOOK_RETRY_QUEUE_BATCH_SIZE,
  type WebhookDeliveryResult,
} from "@/lib/webhook-deliver";
import { recordWebhookDelivery, toWebhookPayload } from "@/lib/webhook-event-store";
import type { DeliveryStatus, Prisma } from "@prisma/client";

export interface RecordDeliveryOptions {
  responseCode?: number;
  isReplay?: boolean;
  replayBatchId?: string;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
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

// ── Retry queue ────────────────────────────────────────────────
//
// Failed deliveries are persisted as RETRYING with `nextAttemptAt` set on the
// 1m → 5m → 15m → 1h → 4h schedule (see webhook-deliver.ts). A cron run drains
// the due rows; after the fifth failed retry the row becomes DEAD_LETTER and
// the existing DLQ tooling takes over.

export interface WebhookRetryQueueSummary {
  /** RETRYING rows that were due this run. */
  scanned: number;
  /** Deliveries that succeeded on retry. */
  delivered: number;
  /** Deliveries rescheduled with the next backoff step. */
  rescheduled: number;
  /** Deliveries that exhausted the schedule and were dead-lettered. */
  deadLettered: number;
  /** Rows whose retry could not be recorded/processed. */
  errors: number;
}

export interface ProcessWebhookRetryQueueOptions {
  /** Clock for due selection and next-attempt math (injectable in tests). */
  now?: Date;
  /** Maximum rows to process this run. */
  limit?: number;
  /** Injectable delivery function (tests). */
  deliver?: typeof deliverWebhook;
}

/**
 * Process due webhook retries.
 *
 * Each row is delivered once (in-process retries are disabled — the persisted
 * schedule is the retry mechanism). The outcome is one of:
 *
 * - success → SUCCESS, queue fields cleared
 * - failure with retries left → RETRYING, nextAttemptAt advanced
 * - failure on the final retry → DEAD_LETTER
 *
 * A single broken row never aborts the batch: errors are counted and the run
 * continues, so a bad subscriber cannot starve the rest of the queue.
 */
export async function processWebhookRetryQueue(
  options: ProcessWebhookRetryQueueOptions = {},
): Promise<WebhookRetryQueueSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(
    Math.max(options.limit ?? WEBHOOK_RETRY_QUEUE_BATCH_SIZE, 1),
    200,
  );
  const deliver = options.deliver ?? deliverWebhook;

  const summary: WebhookRetryQueueSummary = {
    scanned: 0,
    delivered: 0,
    rescheduled: 0,
    deadLettered: 0,
    errors: 0,
  };

  type DueDelivery = Prisma.WebhookDeliveryGetPayload<{
    include: { webhook: true; event: true };
  }>;

  let due: DueDelivery[];
  try {
    due = await prisma.webhookDelivery.findMany({
      where: {
        status: "RETRYING" as DeliveryStatus,
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      include: { webhook: true, event: true },
    });
  } catch (err) {
    logger.error("Webhook retry queue read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    summary.errors += 1;
    return summary;
  }

  summary.scanned = due.length;

  for (const delivery of due) {
    try {
      const payload = toWebhookPayload(delivery.event);
      // One HTTP attempt per queue cycle: the schedule, not the in-request
      // retry loop, is what spaces attempts out.
      const result = await deliver(
        delivery.webhook.url,
        delivery.webhook.secret,
        payload,
        1,
      );

      const retryCount = delivery.retryCount + 1;
      const nextAttemptAt = result.success
        ? null
        : nextWebhookAttemptAt(retryCount, now);
      const status: DeliveryStatus = result.success
        ? "SUCCESS"
        : deliveryStatusAfterFailure(retryCount);

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          retryCount,
          nextAttemptAt,
          lastAttemptAt: now,
          attempts: result.attempts,
          responseCode: result.statusCode,
          latencyMs: result.latencyMs,
          errorMessage: result.errorMessage ?? null,
        },
      });

      if (result.success) {
        summary.delivered += 1;
      } else if (status === "DEAD_LETTER") {
        summary.deadLettered += 1;
        logger.error("Webhook delivery exhausted retries — dead-lettered", {
          deliveryId: delivery.id,
          webhookId: delivery.webhookId,
          retryCount,
        });
      } else {
        summary.rescheduled += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logger.error("Webhook retry processing failed", {
        deliveryId: delivery.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Webhook retry queue processed", { ...summary });
  return summary;
}

export { toWebhookPayload, deliverWebhook };
export type { WebhookDeliveryResult };
