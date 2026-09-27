// SPDX-License-Identifier: MIT
//
// Webhook persistence — the single writer of the event log and delivery
// ledger. Both the original dispatch and the replay/redeliver flows go
// through these functions, so a delivered event is recorded identically
// whichever path produced it.

import prisma from "@/lib/prisma";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import type { DeliveryStatus } from "@prisma/client";
import { resolveReplayBounds, type ReplaySelectionParams, type ReplaySelectionResult } from "./replay";
import type { WebhookDeliveryResult } from "./types";

export interface StoredWebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface RecordDeliveryOptions {
  responseCode?: number;
  isReplay?: boolean;
  replayBatchId?: string;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
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
  options?: {
    responseCode?: number;
    latencyMs?: number;
    attempts?: number;
    errorMessage?: string;
    isReplay?: boolean;
    replayBatchId?: string;
  },
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

/**
 * Select stored events eligible for replay within the bounded window.
 * Only returns events matching the webhook's subscribed event types.
 */
export async function selectEventsForReplay(
  params: ReplaySelectionParams,
): Promise<ReplaySelectionResult> {
  const bounds = resolveReplayBounds(params);

  if (bounds.since > bounds.until) {
    return { ...bounds, events: [] };
  }

  if (params.subscribedEvents.length === 0) {
    return { ...bounds, events: [] };
  }

  const events = await prisma.webhookEvent.findMany({
    where: {
      userId: params.userId,
      event: { in: params.subscribedEvents },
      timestamp: {
        gte: bounds.since,
        lte: bounds.until,
      },
    },
    orderBy: { timestamp: "asc" },
    take: bounds.limit,
    select: {
      id: true,
      event: true,
      timestamp: true,
      data: true,
    },
  });

  return { ...bounds, events };
}

/** Turn a stored event row back into the signed payload envelope. */
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
