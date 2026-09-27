// SPDX-License-Identifier: MIT
//
// Webhook replay bounds — the single source of truth for how far back a
// replay may reach and how many events it may select.
//
// The constants are data, not policy, so the API route, the persistence
// layer and the tests all agree on the same limits.

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

/** Resolve and clamp a replay window + limit to safe bounds. */
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
