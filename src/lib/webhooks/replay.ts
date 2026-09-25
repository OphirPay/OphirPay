// SPDX-License-Identifier: MIT

/**
 * Webhook Replay Configuration & Event Selection Bounds
 *
 * Enforces historical window bounds and limits on replay operations to prevent
 * database exhaustion or DOS attacks.
 */

import prisma from "@/lib/prisma";

/** Maximum lookback window for historical webhook replay (days). */
export const REPLAY_MAX_DAYS = 7;

/** Hard cap on events replayed in a single request. */
export const REPLAY_MAX_COUNT = 100;

/** Default number of events to replay when no limit is provided. */
export const REPLAY_DEFAULT_COUNT = 50;

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
