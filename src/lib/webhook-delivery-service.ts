// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  deliverWebhook,
  type WebhookDeliveryResult,
  WEBHOOK_RETRY_SCHEDULE_MS,
  MAX_WEBHOOK_RETRIES,
  computeNextRetryDelayMs,
  computeNextAttemptAt,
} from "@/lib/webhook-deliver";
import { recordWebhookDelivery, toWebhookPayload } from "@/lib/webhook-event-store";
import type { DeliveryStatus } from "@prisma/client";

export interface RecordDeliveryOptions {
  responseCode?: number;
  isReplay?: boolean;
  replayBatchId?: string;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
  nextAttemptAt?: Date | null;
}

/** Map deliverWebhook output into a delivery ledger row with backoff schedule calculation. */
export async function persistDeliveryResult(
  webhookId: string,
  eventId: string,
  result: WebhookDeliveryResult,
  options?: Omit<RecordDeliveryOptions, "responseCode" | "latencyMs" | "errorMessage">,
): Promise<string> {
  const attempts = options?.attempts ?? result.attempts ?? 1;
  let status: DeliveryStatus = "SUCCESS";
  let nextAttemptAt: Date | null = null;

  if (!result.success) {
    if (attempts < MAX_WEBHOOK_RETRIES) {
      status = "RETRYING";
      nextAttemptAt = computeNextAttemptAt(attempts);
    } else {
      status = "DEAD_LETTER";
      nextAttemptAt = null;
    }
  }

  return recordWebhookDelivery(
    webhookId,
    eventId,
    status,
    {
      responseCode: result.statusCode,
      latencyMs: result.latencyMs,
      attempts,
      errorMessage: result.errorMessage,
      nextAttemptAt,
      ...options,
    },
  );
}

export interface RetryQueueProcessOptions {
  limit?: number;
  now?: Date;
}

export interface RetryQueueItemResult {
  deliveryId: string;
  webhookId: string;
  attempt: number;
  status: "SUCCESS" | "RETRYING" | "DEAD_LETTER" | "SKIPPED";
  error?: string;
}

export interface RetryQueueSummary {
  picked: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  skipped: number;
  results: RetryQueueItemResult[];
}

/**
 * Scan and process failed webhook deliveries pending retry.
 * Backoff schedule: 1m -> 5m -> 15m -> 1h -> 4h -> DEAD_LETTER.
 */
export async function processWebhookRetryQueue(
  options?: RetryQueueProcessOptions
): Promise<RetryQueueSummary> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 50;

  const pending = await prisma.webhookDelivery.findMany({
    where: {
      status: "RETRYING",
      nextAttemptAt: {
        lte: now,
      },
    },
    include: {
      webhook: true,
      event: true,
    },
    orderBy: {
      nextAttemptAt: "asc",
    },
    take: limit,
  });

  const summary: RetryQueueSummary = {
    picked: pending.length,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    skipped: 0,
    results: [],
  };

  for (const delivery of pending) {
    // If webhook is missing or inactive, mark as DEAD_LETTER
    if (!delivery.webhook || !delivery.webhook.isActive) {
      const msg = !delivery.webhook
        ? "Webhook configuration no longer exists"
        : "Webhook configuration is disabled";
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DEAD_LETTER",
          nextAttemptAt: null,
          errorMessage: msg,
        },
      });
      summary.deadLettered += 1;
      summary.results.push({
        deliveryId: delivery.id,
        webhookId: delivery.webhookId,
        attempt: delivery.attempts,
        status: "DEAD_LETTER",
        error: msg,
      });
      continue;
    }

    // If event payload is missing, mark as DEAD_LETTER
    if (!delivery.event) {
      const msg = "Associated webhook event payload missing";
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DEAD_LETTER",
          nextAttemptAt: null,
          errorMessage: msg,
        },
      });
      summary.deadLettered += 1;
      summary.results.push({
        deliveryId: delivery.id,
        webhookId: delivery.webhookId,
        attempt: delivery.attempts,
        status: "DEAD_LETTER",
        error: msg,
      });
      continue;
    }

    const payload = toWebhookPayload(delivery.event);
    const nextAttempt = delivery.attempts + 1;

    try {
      const result = await deliverWebhook(
        delivery.webhook.url,
        delivery.webhook.secret,
        payload
      );

      if (result.success) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "SUCCESS",
            attempts: nextAttempt,
            responseCode: result.statusCode,
            latencyMs: result.latencyMs,
            errorMessage: null,
            nextAttemptAt: null,
            deliveredAt: new Date(),
          },
        });
        summary.succeeded += 1;
        summary.results.push({
          deliveryId: delivery.id,
          webhookId: delivery.webhookId,
          attempt: nextAttempt,
          status: "SUCCESS",
        });
      } else {
        const exhausted = nextAttempt >= MAX_WEBHOOK_RETRIES;
        const nextAttemptAt = exhausted
          ? null
          : computeNextAttemptAt(nextAttempt, now);
        const finalStatus = exhausted ? "DEAD_LETTER" : "RETRYING";

        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: finalStatus,
            attempts: nextAttempt,
            responseCode: result.statusCode,
            latencyMs: result.latencyMs,
            errorMessage: result.errorMessage ?? "Delivery failed",
            nextAttemptAt,
          },
        });

        if (exhausted) {
          summary.deadLettered += 1;
          summary.results.push({
            deliveryId: delivery.id,
            webhookId: delivery.webhookId,
            attempt: nextAttempt,
            status: "DEAD_LETTER",
            error: result.errorMessage,
          });
        } else {
          summary.retried += 1;
          summary.results.push({
            deliveryId: delivery.id,
            webhookId: delivery.webhookId,
            attempt: nextAttempt,
            status: "RETRYING",
            error: result.errorMessage,
          });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const exhausted = nextAttempt >= MAX_WEBHOOK_RETRIES;
      const nextAttemptAt = exhausted
        ? null
        : computeNextAttemptAt(nextAttempt, now);
      const finalStatus = exhausted ? "DEAD_LETTER" : "RETRYING";

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: finalStatus,
          attempts: nextAttempt,
          errorMessage: errorMsg,
          nextAttemptAt,
        },
      });

      if (exhausted) {
        summary.deadLettered += 1;
        summary.results.push({
          deliveryId: delivery.id,
          webhookId: delivery.webhookId,
          attempt: nextAttempt,
          status: "DEAD_LETTER",
          error: errorMsg,
        });
      } else {
        summary.retried += 1;
        summary.results.push({
          deliveryId: delivery.id,
          webhookId: delivery.webhookId,
          attempt: nextAttempt,
          status: "RETRYING",
          error: errorMsg,
        });
      }
    }
  }

  logger.info("Webhook retry queue sweep complete", {
    picked: summary.picked,
    succeeded: summary.succeeded,
    retried: summary.retried,
    deadLettered: summary.deadLettered,
  });

  return summary;
}

export {
  toWebhookPayload,
  deliverWebhook,
  WEBHOOK_RETRY_SCHEDULE_MS,
  MAX_WEBHOOK_RETRIES,
  computeNextRetryDelayMs,
  computeNextAttemptAt,
};
export type { WebhookDeliveryResult };
