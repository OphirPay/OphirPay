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
  /** Gauge: currently open SSE event-stream connections (inc on connect, dec on disconnect). */
  sse_open_connections: 0,
};

export type MetricName = keyof typeof counters;
export type DeliveryType = "webhook" | "batch";
export type DeliveryFinalOutcome = "success" | "failure";

export interface DeliveryAttemptMetric {
  delivery_type: DeliveryType;
  attempt_number: number;
  count: number;
}

export interface DeliveryFinalOutcomeMetric extends DeliveryAttemptMetric {
  final_outcome: DeliveryFinalOutcome;
}

const deliveryAttempts = new Map<string, DeliveryAttemptMetric>();
const deliveryFinalOutcomes = new Map<string, DeliveryFinalOutcomeMetric>();

function assertAttemptNumber(attemptNumber: number): void {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("attemptNumber must be a positive integer");
  }
}

function attemptKey(deliveryType: DeliveryType, attemptNumber: number): string {
  return `${deliveryType}:${attemptNumber}`;
}

function finalOutcomeKey(
  deliveryType: DeliveryType,
  attemptNumber: number,
  finalOutcome: DeliveryFinalOutcome
): string {
  return `${deliveryType}:${attemptNumber}:${finalOutcome}`;
}

/** Increment a named counter. */
export function incMetric(name: MetricName, delta = 1): void {
  counters[name] += delta;
}

/** Count one delivery attempt for a webhook or batch delivery path. */
export function incDeliveryAttempt(
  deliveryType: DeliveryType,
  attemptNumber: number
): void {
  assertAttemptNumber(attemptNumber);
  const key = attemptKey(deliveryType, attemptNumber);
  const current = deliveryAttempts.get(key);

  deliveryAttempts.set(key, {
    delivery_type: deliveryType,
    attempt_number: attemptNumber,
    count: (current?.count ?? 0) + 1,
  });
}

/** Count the terminal delivery outcome, labelled by final attempt number. */
export function incDeliveryFinalOutcome(
  deliveryType: DeliveryType,
  attemptNumber: number,
  finalOutcome: DeliveryFinalOutcome
): void {
  assertAttemptNumber(attemptNumber);
  const key = finalOutcomeKey(deliveryType, attemptNumber, finalOutcome);
  const current = deliveryFinalOutcomes.get(key);

  deliveryFinalOutcomes.set(key, {
    delivery_type: deliveryType,
    attempt_number: attemptNumber,
    final_outcome: finalOutcome,
    count: (current?.count ?? 0) + 1,
  });
}

/** Record a duration observation in seconds. */
export function observeDbQuery(durationSeconds: number): void {
  counters.db_query_duration_seconds_sum += durationSeconds;
  counters.db_query_duration_seconds_count += 1;
}

/** Read current counter values (for scraping). */
export function getMetricsSnapshot(): typeof counters & {
  delivery_attempts: DeliveryAttemptMetric[];
  delivery_final_outcomes: DeliveryFinalOutcomeMetric[];
} {
  return {
    ...counters,
    delivery_attempts: [...deliveryAttempts.values()].sort(
      (a, b) =>
        a.delivery_type.localeCompare(b.delivery_type) ||
        a.attempt_number - b.attempt_number
    ),
    delivery_final_outcomes: [...deliveryFinalOutcomes.values()].sort(
      (a, b) =>
        a.delivery_type.localeCompare(b.delivery_type) ||
        a.attempt_number - b.attempt_number ||
        a.final_outcome.localeCompare(b.final_outcome)
    ),
  };
}

export function resetMetricsForTest(): void {
  for (const key of Object.keys(counters) as MetricName[]) {
    counters[key] = 0;
  }
  deliveryAttempts.clear();
  deliveryFinalOutcomes.clear();
}

// ── Per-endpoint latency histograms and error counts ──────────
//
// Latency is recorded per (method + endpoint + status class) so operators
// can see, for every route, how slow it is and how often it fails. The
// "endpoint" key keeps dynamic segments literal (e.g. `/api/payments/[id]`)
// so each route produces a stable, bounded set of time series.

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

/** Histogram bucket upper bounds (seconds). A trailing +Inf bound is implied. */
export const LATENCY_BUCKET_BOUNDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export interface EndpointObservation {
  requests: number;
  errors: number;
  latencySum: number;
  latencyCount: number;
  /** Cumulative counts per bucket; length = LATENCY_BUCKET_BOUNDS.length + 1 (+Inf). */
  buckets: number[];
}

const endpointMetrics = new Map<string, EndpointObservation>();

function statusClassOf(status: number): StatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/**
 * Record a single request's latency keyed by endpoint + status class.
 * `status` may be 0 when the handler didn't return a Response we can read;
 * it is treated as a successful (2xx) request in that case.
 */
export function recordEndpointLatency(
  method: string,
  endpoint: string,
  status: number,
  durationSeconds: number
): void {
  const statusClass = statusClassOf(status || 200);
  const key = `${method} ${endpoint}|${statusClass}`;

  let obs = endpointMetrics.get(key);
  if (!obs) {
    obs = {
      requests: 0,
      errors: 0,
      latencySum: 0,
      latencyCount: 0,
      buckets: new Array(LATENCY_BUCKET_BOUNDS.length + 1).fill(0),
    };
    endpointMetrics.set(key, obs);
  }

  obs.requests += 1;
  obs.latencySum += durationSeconds;
  obs.latencyCount += 1;
  if (statusClass === "4xx" || statusClass === "5xx") obs.errors += 1;

  for (let i = 0; i < LATENCY_BUCKET_BOUNDS.length; i++) {
    if (durationSeconds <= LATENCY_BUCKET_BOUNDS[i]) obs.buckets[i] += 1;
  }
  // +Inf bucket always counts the observation.
  obs.buckets[LATENCY_BUCKET_BOUNDS.length] += 1;
}

export interface EndpointMetricEntry {
  method: string;
  endpoint: string;
  statusClass: StatusClass;
  observation: EndpointObservation;
}

/** Read all collected per-endpoint observations (for scraping/serialization). */
export function getEndpointMetrics(): EndpointMetricEntry[] {
  const entries: EndpointMetricEntry[] = [];
  for (const [key, observation] of endpointMetrics.entries()) {
    const [methodAndEndpoint, statusClass] = key.split("|");
    const [method, ...rest] = methodAndEndpoint.split(" ");
    entries.push({
      method,
      endpoint: rest.join(" "),
      statusClass: statusClass as StatusClass,
      observation,
    });
  }
  return entries;
}

/** Reset per-endpoint metrics. Intended for tests. */
export function resetEndpointMetrics(): void {
  endpointMetrics.clear();
}
