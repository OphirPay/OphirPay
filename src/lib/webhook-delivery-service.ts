// SPDX-License-Identifier: MIT

import { deliverWebhook, type WebhookDeliveryResult } from "@/lib/webhook-deliver";
import { recordWebhookDelivery, toWebhookPayload } from "@/lib/webhook-event-store";
import type { DeliveryStatus } from "@prisma/client";

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

export { toWebhookPayload, deliverWebhook };
export type { WebhookDeliveryResult };
