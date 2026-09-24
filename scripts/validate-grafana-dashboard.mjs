#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const dashboardPath = path.resolve(
  process.argv[2] ?? "monitoring/grafana-dashboard.json"
);

const publishedMetrics = new Set([
  "ophirpay_http_requests_total",
  "ophirpay_payments_created_total",
  "ophirpay_payments_failed_total",
  "ophirpay_batches_processed_total",
  "ophirpay_webhooks_delivered_total",
  "ophirpay_webhooks_failed_total",
  "ophirpay_delivery_attempts_total",
  "ophirpay_delivery_final_outcomes_total",
  "ophirpay_db_query_duration_seconds_sum",
  "ophirpay_db_query_duration_seconds_count",
  "ophirpay_endpoint_request_duration_seconds",
  "ophirpay_endpoint_errors_total",
  "ophirpay_info",
  "ophirpay_process_resident_set_bytes",
  "ophirpay_process_heap_used_bytes",
  "ophirpay_process_heap_total_bytes",
  "ophirpay_sse_open_connections",
]);

function fail(message) {
  throw new Error(`Grafana dashboard validation failed: ${message}`);
}

let dashboard;
try {
  dashboard = JSON.parse(fs.readFileSync(dashboardPath, "utf8"));
} catch (error) {
  fail(`cannot parse ${dashboardPath}: ${error.message}`);
}

if (!dashboard || typeof dashboard !== "object" || Array.isArray(dashboard)) {
  fail("top-level value must be an object");
}
if (dashboard.title !== "OphirPay — Payment Infrastructure") fail("title is missing or changed");
if (dashboard.uid !== "ophirpay") fail("uid must be 'ophirpay'");
if (!Number.isInteger(dashboard.schemaVersion) || dashboard.schemaVersion < 39) {
  fail("schemaVersion must target Grafana schema 39 or newer");
}
if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
  fail("panels must be a non-empty array");
}

const metricPattern = /\bophirpay_[a-zA-Z0-9_]+/g;
const references = [];
for (const [index, panel] of dashboard.panels.entries()) {
  if (!panel || typeof panel !== "object") fail(`panel ${index + 1} must be an object`);
  if (!Number.isInteger(panel.id) || typeof panel.title !== "string" || typeof panel.type !== "string") {
    fail(`panel ${index + 1} is missing id, title, or type`);
  }
  if (!Array.isArray(panel.targets) || panel.targets.length === 0) {
    fail(`panel ${panel.id} (${panel.title}) must have at least one target`);
  }
  for (const target of panel.targets) {
    if (!target || typeof target.expr !== "string" || target.expr.trim() === "") {
      fail(`panel ${panel.id} (${panel.title}) has a target without an expression`);
    }
    for (const metric of target.expr.match(metricPattern) ?? []) {
      references.push({ metric, panel: panel.title });
    }
  }
}

for (const { metric, panel } of references) {
  if (!publishedMetrics.has(metric)) {
    fail(`panel "${panel}" references unpublished metric ${metric}`);
  }
}

console.log(
  `Grafana dashboard valid: schema ${dashboard.schemaVersion}, ${dashboard.panels.length} panels, ${new Set(references.map(({ metric }) => metric)).size} published metrics`
);
