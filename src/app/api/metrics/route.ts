// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { NextResponse } from "next/server";
import {
  getMetricsSnapshot,
  getEndpointMetrics,
  LATENCY_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";

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
    "# HELP ophirpay_db_query_duration_seconds_sum Database query duration sum",
    "# TYPE ophirpay_db_query_duration_seconds_sum summary",
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

export const GET = withMetrics("GET /api/metrics", async function GET() {
  return new NextResponse(buildMetrics(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
});
