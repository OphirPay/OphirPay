// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  REPLAY_DEFAULT_COUNT,
  REPLAY_MAX_COUNT,
  REPLAY_MAX_DAYS,
} from "@/lib/webhook-replay-config";
import type { DeliveryStatus, WebhookFailureReason } from "@prisma/client";

export interface StoredWebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ReplaySelectionParams {
  userId: string;
  subscribedEvents: string[];
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface ReplaySelectionResult {
  events: Array<{
    id: string;
    event: string;
    timestamp: Date;
    data: string;
  }>;
  since: Date;
  until: Date;
  limit: number;
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

export interface RecordWebhookDeliveryOptions {
  responseCode?: number;
  latencyMs?: number;
  attempts?: number;
  errorMessage?: string;
  isReplay?: boolean;
  replayBatchId?: string;
  /** Classified failure reason (issue #806) — set on non-SUCCESS deliveries. */
  failureReason?: WebhookFailureReason;
  /** Target URL the payload was sent to, retained alongside the dead letter. */
  targetUrl?: string;
  canonicalBody?: string;
  requestBody?: string;
  signature?: string;
  requestHeaders?: string;
  responseBody?: string;
  durationMs?: number;
  error?: string;
  /** Set when this delivery exhausted its retry budget and was dead-lettered. */
  deadLetteredAt?: Date;
  /** Correlates every delivery created by one bulk dead-letter redelivery request. */
  redeliveryBatchId?: string;
  /** The id of the dead-lettered delivery this row was redelivered from. */
  redeliveredFromId?: string;
}

/** Record a delivery attempt (original, replay, or dead-letter redelivery). */
export async function recordWebhookDelivery(
  webhookId: string,
  eventId: string,
  status: DeliveryStatus,
  options?: RecordWebhookDeliveryOptions,
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
      failureReason: options?.failureReason,
      targetUrl: options?.targetUrl,
      canonicalBody: options?.canonicalBody,
      requestBody: options?.requestBody,
      signature: options?.signature,
      requestHeaders: options?.requestHeaders,
      responseBody: options?.responseBody,
      durationMs: options?.durationMs,
      error: options?.error,
      deadLetteredAt: options?.deadLetteredAt,
      redeliveryBatchId: options?.redeliveryBatchId,
      redeliveredFromId: options?.redeliveredFromId,
    },
  });
  return row.id;
}

/** Mark a dead-lettered delivery resolved after it has been redelivered successfully. */
export async function resolveDeadLetteredDelivery(deliveryId: string): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { resolvedAt: new Date() },
  });
}

/** Resolve and clamp replay window + limit to safe bounds. */
export function resolveReplayBounds(params: ReplaySelectionParams): ReplaySelectionResult {
  const now = new Date();
  const earliestAllowed = new Date(now.getTime() - REPLAY_MAX_DAYS * 24 * 60 * 60 * 1000);

  const requestedSince = params.since ?? earliestAllowed;
  const since = requestedSince < earliestAllowed ? earliestAllowed : requestedSince;

  const requestedUntil = params.until ?? now;
  const until = requestedUntil > now ? now : requestedUntil;

  const rawLimit = params.limit ?? REPLAY_DEFAULT_COUNT;
  const limit = Math.min(REPLAY_MAX_COUNT, Math.max(1, rawLimit));

  return { events: [], since, until, limit };
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
