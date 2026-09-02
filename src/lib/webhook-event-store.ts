// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  REPLAY_DEFAULT_COUNT,
  REPLAY_MAX_COUNT,
  REPLAY_MAX_DAYS,
} from "@/lib/webhook-replay-config";
import type { DeliveryStatus } from "@prisma/client";

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

/** Record a delivery attempt (original or replay) for dashboard visibility. */
export async function recordWebhookDelivery(
  webhookId: string,
  eventId: string,
  status: DeliveryStatus,
  options?: {
    responseCode?: number;
    isReplay?: boolean;
    replayBatchId?: string;
  },
): Promise<void> {
  await prisma.webhookDelivery.create({
    data: {
      webhookId,
      eventId,
      status,
      responseCode: options?.responseCode,
      isReplay: options?.isReplay ?? false,
      replayBatchId: options?.replayBatchId,
    },
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
