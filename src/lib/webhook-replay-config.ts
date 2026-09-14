// SPDX-License-Identifier: MIT

/** Maximum lookback window for historical webhook replay (days). */
export const REPLAY_MAX_DAYS = 7;

/** Hard cap on events replayed in a single request. */
export const REPLAY_MAX_COUNT = 100;

/** Default number of events to replay when no limit is provided. */
export const REPLAY_DEFAULT_COUNT = 50;
