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
  /**
   * Counter: SSE events shed because a slow/stalled consumer exhausted its
   * bounded outbound buffer (issue #744). A rising value with a flat
   * `sse_open_connections` means clients are being out-paced by the stream.
   */
  sse_dropped_events_total: 0,
  /** Counter: cumulative RPC failover transitions (issue #820). */
  rpc_failover_total: 0,
  /** Counter: cumulative RPC recoveries to the primary endpoint (issue #820). */
  rpc_failover_recoveries_total: 0,
  /** Counter: cumulative RPC circuit breaker trips (issue #1421). */
  rpc_circuit_breaker_trips_total: 0,
  /**
   * Counter: CSP violation reports received at POST /api/csp-report (issue #698).
   * Incremented once per accepted, parsed, and logged report.  Oversized or
   * malformed requests are rejected before reaching this counter.
   */
  csp_violation_reports_total: 0,
  /** Gauge: Prisma connection pool queue wait duration in seconds (issue #1412). */
  database_pool_wait_seconds: 0,
};

/** Set the Prisma connection pool queue wait time in seconds (issue #1412). */
export function setDatabasePoolWaitSeconds(seconds: number): void {
  counters.database_pool_wait_seconds = seconds;
}

/** Map of currently active SSE connections keyed by route (issue #1425). */
const sseActiveConnections = new Map<string, number>([
  ["events", 0],
  ["audit-log", 0],
]);

/** Increment or decrement active SSE connection gauge for a specific route (issue #1425). */
export function incSseActiveConnection(route: string, delta = 1): void {
  const current = sseActiveConnections.get(route) ?? 0;
  const next = Math.max(0, current + delta);
  sseActiveConnections.set(route, next);
}

/** Get snapshot of active SSE connections by route (issue #1425). */
export function getSseActiveConnections(): Array<{ route: string; count: number }> {
  return Array.from(sseActiveConnections.entries()).map(([route, count]) => ({
    route,
    count,
  }));
}

/** Histogram bucket upper bounds (seconds) for SSE connection duration (issue #1425). */
export const SSE_DURATION_BUCKET_BOUNDS = [
  1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600,
];

export interface SseDurationObservation {
  count: number;
  sum: number;
  buckets: number[];
}

const sseDurations = new Map<string, SseDurationObservation>();

/** Record an SSE connection duration in seconds for a specific route (issue #1425). */
export function recordSseConnectionDuration(
  route: string,
  durationSeconds: number
): void {
  let obs = sseDurations.get(route);
  if (!obs) {
    obs = {
      count: 0,
      sum: 0,
      buckets: new Array(SSE_DURATION_BUCKET_BOUNDS.length + 1).fill(0),
    };
    sseDurations.set(route, obs);
  }
  obs.count += 1;
  obs.sum += durationSeconds;
  for (let i = 0; i < SSE_DURATION_BUCKET_BOUNDS.length; i++) {
    if (durationSeconds <= SSE_DURATION_BUCKET_BOUNDS[i]) {
      obs.buckets[i] += 1;
    }
  }
  obs.buckets[SSE_DURATION_BUCKET_BOUNDS.length] += 1;
}

/** Get snapshot of recorded SSE connection duration observations (issue #1425). */
export function getSseDurations(): Array<{
  route: string;
  observation: SseDurationObservation;
}> {
  return Array.from(sseDurations.entries()).map(([route, observation]) => ({
    route,
    observation: {
      count: observation.count,
      sum: observation.sum,
      buckets: [...observation.buckets],
    },
  }));
}

export type CspReportDropReason = "rate_limited" | "deduplicated" | "oversized";

const cspReportsDropped = new Map<CspReportDropReason, number>([
  ["rate_limited", 0],
  ["deduplicated", 0],
  ["oversized", 0],
]);

/** Increment the counter for dropped CSP violation reports (#1392). */
export function incCspReportsDropped(reason: CspReportDropReason, delta = 1): void {
  cspReportsDropped.set(reason, (cspReportsDropped.get(reason) ?? 0) + delta);
}

/** Get a snapshot of dropped CSP report counts by reason. */
export function getCspReportsDroppedSnapshot(): Record<CspReportDropReason, number> {
  return {
    rate_limited: cspReportsDropped.get("rate_limited") ?? 0,
    deduplicated: cspReportsDropped.get("deduplicated") ?? 0,
    oversized: cspReportsDropped.get("oversized") ?? 0,
  };
}

/** Last failover snapshot read by a scrape, for diffing gauge/counter gauges. */
let lastRpcFailover: {
  failoverCount: number;
  recoveryCount: number;
  activeEndpoint: string | null;
  primaryEndpoint: string | null;
  usingFallback: boolean;
  currentFallbackDurationMs: number;
  longestFallbackDurationMs: number;
} | null = null;

/** Store the latest RPC failover state so the metrics exposition stays consistent. */
export function recordRpcFailoverState(state: NonNullable<typeof lastRpcFailover>): void {
  lastRpcFailover = state;
  counters.rpc_failover_total = state.failoverCount;
  counters.rpc_failover_recoveries_total = state.recoveryCount;
}

/** Read the last recorded RPC failover state (null before the first record). */
export function getRpcFailoverSnapshot(): typeof lastRpcFailover {
  return lastRpcFailover;
}

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
  csp_reports_dropped: Record<CspReportDropReason, number>;
  sse_active_connections: Array<{ route: string; count: number }>;
  sse_connection_durations: Array<{
    route: string;
    observation: SseDurationObservation;
  }>;
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
    csp_reports_dropped: getCspReportsDroppedSnapshot(),
    sse_active_connections: getSseActiveConnections(),
    sse_connection_durations: getSseDurations(),
  };
}

export function resetMetricsForTest(): void {
  for (const key of Object.keys(counters) as MetricName[]) {
    counters[key] = 0;
  }
  deliveryAttempts.clear();
  deliveryFinalOutcomes.clear();
  lastRpcFailover = null;
  rpcRequestsTotal.set("2xx", 0);
  rpcRequestsTotal.set("5xx", 0);
  rpcLatencySum = 0;
  rpcLatencyCount = 0;
  rpcLatencyBuckets.fill(0);
  for (const reason of ["rate_limited", "deduplicated", "oversized"] as CspReportDropReason[]) {
    cspReportsDropped.set(reason, 0);
  }
  sseActiveConnections.set("events", 0);
  sseActiveConnections.set("audit-log", 0);
  sseDurations.clear();
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

const rpcRequestsTotal = new Map<string, number>([
  ["2xx", 0],
  ["5xx", 0],
]);

const rpcLatencyBuckets = new Array(LATENCY_BUCKET_BOUNDS.length + 1).fill(0);
let rpcLatencySum = 0;
let rpcLatencyCount = 0;

/** Record Soroban RPC request observation (latency and status class) (issue #1412). */
export function recordRpcObservation(
  statusClass: "2xx" | "5xx",
  durationSeconds: number
): void {
  rpcRequestsTotal.set(
    statusClass,
    (rpcRequestsTotal.get(statusClass) ?? 0) + 1
  );
  rpcLatencySum += durationSeconds;
  rpcLatencyCount += 1;
  const bucketIndex = LATENCY_BUCKET_BOUNDS.findIndex(
    (bound) => durationSeconds <= bound
  );
  if (bucketIndex === -1) {
    rpcLatencyBuckets[LATENCY_BUCKET_BOUNDS.length] += 1;
  } else {
    rpcLatencyBuckets[bucketIndex] += 1;
  }
}

/** Get snapshot of Soroban RPC metrics (issue #1412). */
export function getRpcMetricsSnapshot() {
  return {
    requestsTotal: {
      "2xx": rpcRequestsTotal.get("2xx") ?? 0,
      "5xx": rpcRequestsTotal.get("5xx") ?? 0,
    },
    latencySum: rpcLatencySum,
    latencyCount: rpcLatencyCount,
    buckets: [...rpcLatencyBuckets],
  };
}

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
