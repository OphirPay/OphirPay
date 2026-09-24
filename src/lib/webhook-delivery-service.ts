// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { deliverWebhook, type WebhookDeliveryResult } from "@/lib/webhook-deliver";
import { recordWebhookDelivery, toWebhookPayload } from "@/lib/webhook-event-store";

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
    result.success ? "SUCCESS" : "FAILED",
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
 * Move an exhausted FAILED delivery into the explicit dead-letter state.
 * Retains the payload (via the linked event row), the last response and the
 * failure reason so it stays queryable and bulk-redeliverable. Idempotent:
 * already dead-lettered rows keep their original timestamp.
 */
export async function moveToDeadLetter(
  deliveryId: string,
  reason: string,
): Promise<void> {
  const existing = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, status: true },
  });
  if (!existing || existing.status === "DEAD_LETTERED") return;

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "DEAD_LETTERED",
      deadLetterReason: reason,
      deadLetteredAt: new Date(),
    },
  });
  incMetric("webhooks_dead_lettered_total");
  logger.warn("Webhook delivery moved to dead-letter", { deliveryId, reason });
}

export { toWebhookPayload, deliverWebhook };
export type { WebhookDeliveryResult };
