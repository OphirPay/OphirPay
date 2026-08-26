// SPDX-License-Identifier: MIT

/**
 * Shared Prometheus counter state.
 * Imported by both the metrics API route (for scraping) and by lib/route
 * handlers (for incrementing).
 *
 * These are in-process counters — resets on deploy. For persistent metrics,
 * swap to a Redis-backed counter store.
 */

const counters = {
  http_requests_total: 0,
  payments_created_total: 0,
  payments_failed_total: 0,
  batches_processed_total: 0,
  webhooks_delivered_total: 0,
  webhooks_failed_total: 0,
  db_query_duration_seconds_sum: 0,
  db_query_duration_seconds_count: 0,
};

export type MetricName = keyof typeof counters;

/** Increment a named counter. */
export function incMetric(name: MetricName, delta = 1): void {
  counters[name] += delta;
}

/** Record a duration observation in seconds. */
export function observeDbQuery(durationSeconds: number): void {
  counters.db_query_duration_seconds_sum += durationSeconds;
  counters.db_query_duration_seconds_count += 1;
}

/** Read current counter values (for scraping). */
export function getMetricsSnapshot(): typeof counters {
  return { ...counters };
}
