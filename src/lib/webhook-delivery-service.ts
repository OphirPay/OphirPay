// SPDX-License-Identifier: MIT

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
  options?: Omit<RecordDeliveryOptions, "responseCode" | "latencyMs" | "attempts" | "errorMessage"> & {
    status?: "SUCCESS" | "FAILED" | "DEAD_LETTER";
  },
): Promise<string> {
  const status =
    options?.status ??
    (result.success
      ? "SUCCESS"
      : result.isDeadLetter
      ? "DEAD_LETTER"
      : "FAILED");

  return recordWebhookDelivery(
    webhookId,
    eventId,
    status as any,
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
