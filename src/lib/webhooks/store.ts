// SPDX-License-Identifier: MIT

/**
 * Webhook Event & Delivery Persistence Store
 *
 * Persists webhook events for auditing and historical replay, and logs delivery
 * attempts to maintain an immutable ledger of webhook dispatches.
 */

import prisma from "@/lib/prisma";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import type { DeliveryStatus } from "@prisma/client";
import type { WebhookDeliveryResult } from "./delivery";

export interface StoredWebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface RecordDeliveryOptions {
  responseCode?: number;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
  isReplay?: boolean;
  replayBatchId?: string;
}

/**
 * Persist a webhook event for later replay. Only stores when a user scope is
 * available — events without an owner cannot be replayed safely.
 */
export async function storeWebhookEvent(
  userId: string,
  event: WebhookEventType,
  data: Record<string, unknown>,
  timestamp: string,
): Promise<string | null> {
  const row = await prisma.webhookEvent.create({
    data: {
      userId,
      event,
      timestamp: new Date(timestamp),
      data: JSON.stringify(data),
    },
  });
  return row.id;
}

/** Record a delivery attempt (original or replay) for dashboard visibility. */
export async function recordWebhookDelivery(
  webhookId: string,
  eventId: string,
  status: DeliveryStatus,
  options?: RecordDeliveryOptions,
): Promise<string> {
  const row = await prisma.webhookDelivery.create({
    data: {
      webhookId,
      eventId,
      status,
      responseCode: options?.responseCode,
      latencyMs: options?.latencyMs,
      attempts: options?.attempts ?? 1,
      errorMessage: options?.errorMessage,
      isReplay: options?.isReplay ?? false,
      replayBatchId: options?.replayBatchId,
    },
  });
  return row.id;
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

export function toWebhookPayload(
  stored: Pick<{ event: string; timestamp: Date; data: string }, "event" | "timestamp" | "data">,
): StoredWebhookPayload {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(stored.data) as Record<string, unknown>;
  } catch {
    data = {};
  }

  return {
    event: stored.event,
    timestamp: stored.timestamp.toISOString(),
    data,
  };
}
