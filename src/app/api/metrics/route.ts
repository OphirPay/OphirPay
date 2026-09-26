// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { NextResponse } from "next/server";
import {
  getMetricsSnapshot,
  getEndpointMetrics,
  LATENCY_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";
import { timingSafeEqual } from "@/lib/crypto";
import { authenticateRequest } from "@/lib/api-auth";
import { hasScope, ADMIN_SCOPE } from "@/lib/api-scopes";

/**
 * /api/metrics — Prometheus exposition endpoint.
 *
 * The body is a map of the running process: resident/heap memory, per-endpoint
 * latency histograms and error counts labelled with method/endpoint/status,
 * webhook delivery-attempt and final-outcome counters, and the live count of
 * open SSE connections. On a public deployment that is a free inventory of the
 * API surface with live error rates plus a cheap target for resource-exhaustion
 * probing, so the endpoint requires a credential (issue #699):
 *
 *   • `Authorization: Bearer <METRICS_TOKEN>` — the static scrape credential
 *     the in-cluster Prometheus service monitor is configured to send, or
 *   • an API key (`Authorization: Bearer` / `X-API-Key`) carrying the `admin`
 *     scope, for operators who already manage keys in the dashboard.
 *
 * Denying by default: when `METRICS_TOKEN` is unset and the request carries no
 * usable key, the endpoint returns 401 and no metric body rather than failing
 * open. The Prometheus exposition format is unchanged, so a scraper only needs
 * to add the header.
 */
export const METRICS_TOKEN_ENV = "METRICS_TOKEN";

/** Extract a bearer token from the Authorization header (case-insensitive). */
export function extractBearerToken(request: Request | undefined): string | null {
  const header = request?.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Whether the request may read `/api/metrics`.
 *
 * The static token is compared in constant time. The API-key fallback is only
 * attempted when the request actually carries a key, so an unauthenticated
 * scrape never touches the database.
 */
export async function isAuthorizedMetricsRequest(
  request: Request | undefined
): Promise<boolean> {
  const expected = process.env[METRICS_TOKEN_ENV];
  const provided = extractBearerToken(request);
  if (expected && provided && timingSafeEqual(provided, expected)) return true;

  if (!request) return false;

  const hasKeyHeader =
    request.headers.get("x-api-key") !== null ||
    request.headers.get("authorization") !== null;
  if (!hasKeyHeader) return false;

  const auth = await authenticateRequest(request);
  // `admin` implicitly grants every scope, so an admin key can read metrics.
  return auth !== null && hasScope(auth.scopes, [ADMIN_SCOPE]);
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function labels(labels: Record<string, string | number>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(",");
}

function buildMetrics(): string {
  const c = getMetricsSnapshot();

  const lines: string[] = [
    "# HELP ophirpay_http_requests_total Total HTTP requests served",
    "# TYPE ophirpay_http_requests_total counter",
    `ophirpay_http_requests_total ${c.http_requests_total}`,
    "",
    "# HELP ophirpay_payments_created_total Total payments created",
    "# TYPE ophirpay_payments_created_total counter",
    `ophirpay_payments_created_total ${c.payments_created_total}`,
    "",
    "# HELP ophirpay_payments_failed_total Total failed payment attempts",
    "# TYPE ophirpay_payments_failed_total counter",
    `ophirpay_payments_failed_total ${c.payments_failed_total}`,
    "",
    "# HELP ophirpay_batches_processed_total Total batch payments processed",
    "# TYPE ophirpay_batches_processed_total counter",
    `ophirpay_batches_processed_total ${c.batches_processed_total}`,
    "",
    "# HELP ophirpay_webhooks_delivered_total Total webhooks delivered",
    "# TYPE ophirpay_webhooks_delivered_total counter",
    `ophirpay_webhooks_delivered_total ${c.webhooks_delivered_total}`,
    "",
    "# HELP ophirpay_webhooks_failed_total Total webhooks that failed delivery",
    "# TYPE ophirpay_webhooks_failed_total counter",
    `ophirpay_webhooks_failed_total ${c.webhooks_failed_total}`,
    "",
    "# HELP ophirpay_delivery_attempts_total Total delivery attempts by delivery type and attempt number",
    "# TYPE ophirpay_delivery_attempts_total counter",
    ...c.delivery_attempts.map(
      (metric) =>
        `ophirpay_delivery_attempts_total{${labels({
          delivery_type: metric.delivery_type,
          attempt_number: metric.attempt_number,
        })}} ${metric.count}`
    ),
    "",
    "# HELP ophirpay_delivery_final_outcomes_total Total terminal delivery outcomes by delivery type, final attempt number, and outcome",
    "# TYPE ophirpay_delivery_final_outcomes_total counter",
    ...c.delivery_final_outcomes.map(
      (metric) =>
        `ophirpay_delivery_final_outcomes_total{${labels({
          delivery_type: metric.delivery_type,
          attempt_number: metric.attempt_number,
          final_outcome: metric.final_outcome,
        })}} ${metric.count}`
    ),
    "",
    "# HELP ophirpay_db_query_duration_seconds Database query duration",
    "# TYPE ophirpay_db_query_duration_seconds summary",
    `ophirpay_db_query_duration_seconds_sum ${c.db_query_duration_seconds_sum}`,
    `ophirpay_db_query_duration_seconds_count ${c.db_query_duration_seconds_count}`,
    "",
  ];

  // ── Per-endpoint latency histograms + error counts ──────────
  lines.push(
    "# HELP ophirpay_endpoint_request_duration_seconds Request latency histogram per endpoint and status class",
    "# TYPE ophirpay_endpoint_request_duration_seconds histogram"
  );

  for (const entry of getEndpointMetrics()) {
    const { method, endpoint, statusClass, observation } = entry;
    const baseLabels = `method="${escapeLabelValue(
      method
    )}",endpoint="${escapeLabelValue(endpoint)}",status_class="${statusClass}"`;

    for (let i = 0; i < LATENCY_BUCKET_BOUNDS.length; i++) {
      const le = LATENCY_BUCKET_BOUNDS[i];
      lines.push(
        `ophirpay_endpoint_request_duration_seconds_bucket{${baseLabels},le="${le}"} ${observation.buckets[i]}`
      );
    }
    const infLe = "+Inf";
    lines.push(
      `ophirpay_endpoint_request_duration_seconds_bucket{${baseLabels},le="${infLe}"} ${observation.buckets[LATENCY_BUCKET_BOUNDS.length]}`
    );
    lines.push(
      `ophirpay_endpoint_request_duration_seconds_sum{${baseLabels}} ${observation.latencySum}`
    );
    lines.push(
      `ophirpay_endpoint_request_duration_seconds_count{${baseLabels}} ${observation.latencyCount}`
    );
  }

  lines.push(
    "",
    "# HELP ophirpay_endpoint_errors_total Error counts per endpoint and status class",
    "# TYPE ophirpay_endpoint_errors_total counter"
  );
  for (const entry of getEndpointMetrics()) {
    const { method, endpoint, statusClass, observation } = entry;
    const baseLabels = `method="${escapeLabelValue(
      method
    )}",endpoint="${escapeLabelValue(endpoint)}",status_class="${statusClass}"`;
    lines.push(`ophirpay_endpoint_errors_total{${baseLabels}} ${observation.errors}`);
  }

  lines.push(
    "",
    "# HELP ophirpay_info OphirPay build information",
    "# TYPE ophirpay_info gauge",
    'ophirpay_info{version="1.0.0"} 1'
  );

  // ── Live gauges: process memory + open SSE connections ──────
  // Sampled on scrape so load tests can assert memory stays bounded and
  // that SSE connections are released after clients disconnect.
  const mem = process.memoryUsage();
  lines.push(
    "",
    "# HELP ophirpay_process_resident_set_bytes Process resident set size in bytes",
    "# TYPE ophirpay_process_resident_set_bytes gauge",
    `ophirpay_process_resident_set_bytes ${mem.rss}`,
    "",
    "# HELP ophirpay_process_heap_used_bytes Process heap used in bytes",
    "# TYPE ophirpay_process_heap_used_bytes gauge",
    `ophirpay_process_heap_used_bytes ${mem.heapUsed}`,
    "",
    "# HELP ophirpay_process_heap_total_bytes Process heap total in bytes",
    "# TYPE ophirpay_process_heap_total_bytes gauge",
    `ophirpay_process_heap_total_bytes ${mem.heapTotal}`,
    "",
    "# HELP ophirpay_sse_open_connections Currently open SSE event-stream connections",
    "# TYPE ophirpay_sse_open_connections gauge",
    `ophirpay_sse_open_connections ${c.sse_open_connections}`
  );

  return lines.join("\n") + "\n";
}

function unauthorizedMetricsResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message:
          `A valid metrics credential is required. Send "Authorization: Bearer <${METRICS_TOKEN_ENV}>" ` +
          "or an API key carrying the admin scope.",
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="ophirpay-metrics"',
        "Cache-Control": "no-store",
      },
    }
  );
}

export const GET = withMetrics("GET /api/metrics", async function GET(request: Request) {
  // No credential → no body. Return before building the exposition so a
  // configuration mistake cannot leak the process/endpoint internals.
  if (!(await isAuthorizedMetricsRequest(request))) {
    return unauthorizedMetricsResponse();
  }

  return new NextResponse(buildMetrics(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
});
