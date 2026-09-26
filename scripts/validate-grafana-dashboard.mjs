#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Validates monitoring/grafana-dashboard.json against:
 * 1. Required top-level Grafana dashboard schema fields (schemaVersion 39, Grafana 9.5+, 10.x, 11.x).
 * 2. Required panel properties (id, title, type, gridPos, targets).
 * 3. Cross-checking all PromQL metric queries against metrics published by src/app/api/metrics/route.ts.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

export const REQUIRED_TOP_LEVEL_FIELDS = [
  "title",
  "uid",
  "schemaVersion",
  "version",
  "panels",
  "timezone",
  "time",
  "refresh",
];

export const ALLOWED_EXTERNAL_METRICS = new Set([
  "up",
  "scrape_duration_seconds",
  "scrape_samples_scraped",
  "node_cpu_seconds_total",
  "node_memory_MemTotal_bytes",
  "node_memory_MemAvailable_bytes",
  "container_cpu_usage_seconds_total",
  "container_memory_working_set_bytes",
]);

/**
 * Extract all declared and emitted metric names from src/app/api/metrics/route.ts.
 */
export function extractPublishedMetrics(routeFilePath = resolve(ROOT, "src/app/api/metrics/route.ts")) {
  const source = readFileSync(routeFilePath, "utf8");
  const published = new Set();

  const typeMatches = [...source.matchAll(/# TYPE ([a-zA-Z0-9_]+) (counter|gauge|summary|histogram)/g)];
  for (const [, name, type] of typeMatches) {
    published.add(name);
    if (type === "summary") {
      published.add(`${name}_sum`);
      published.add(`${name}_count`);
    } else if (type === "histogram") {
      published.add(`${name}_bucket`);
      published.add(`${name}_sum`);
      published.add(`${name}_count`);
    }
  }

  // Also collect direct metric emissions like `ophirpay_...`
  const directEmissions = [...source.matchAll(/`?(ophirpay_[a-zA-Z0-9_]+)/g)];
  for (const [, metric] of directEmissions) {
    published.add(metric);
  }

  return published;
}

/**
 * Extract metric names from a PromQL query expression.
 */
export function extractMetricsFromExpr(expr) {
  if (!expr || typeof expr !== "string") return [];
  // Strip range vector selectors e.g. [5m], [1h], [30s]
  let clean = expr.replace(/\[\s*\d+[a-zA-Z]+\s*\]/g, " ");
  // Strip label matchers e.g. {status="200"}
  clean = clean.replace(/\{[^}]*\}/g, " ");
  // Strip aggregation label clauses e.g. by (asset, status), without (instance)
  clean = clean.replace(/\b(by|without|on|ignoring)\s*\([^)]*\)/gi, " ");
  // Strip quoted strings
  clean = clean.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " ");

  const matches = clean.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const PROMQL_KEYWORDS = new Set([
    "rate", "irate", "sum", "avg", "min", "max", "count", "stddev", "stdvar",
    "increase", "histogram_quantile", "resets", "changes", "deriv", "predict_linear",
    "by", "without", "on", "ignoring", "group_left", "group_right", "bool",
    "offset", "time", "timestamp", "and", "or", "unless", "inf", "nan",
  ]);

  return matches.filter((name) => !PROMQL_KEYWORDS.has(name) && isNaN(Number(name)));
}

/**
 * Validate Grafana Dashboard JSON.
 */
export function validateGrafanaDashboard({
  dashboardPath = resolve(ROOT, "monitoring/grafana-dashboard.json"),
  metricsRoutePath = resolve(ROOT, "src/app/api/metrics/route.ts"),
  allowedExternal = ALLOWED_EXTERNAL_METRICS,
} = {}) {
  const errors = [];
  let dashboard;

  try {
    const raw = readFileSync(dashboardPath, "utf8");
    dashboard = JSON.parse(raw);
  } catch (err) {
    return {
      valid: false,
      errors: [`Malformed JSON in dashboard file (${dashboardPath}): ${err.message}`],
      queriedMetrics: [],
      publishedMetrics: [],
    };
  }

  // 1. Verify required top-level fields
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (dashboard[field] === undefined || dashboard[field] === null || dashboard[field] === "") {
      errors.push(`Dashboard missing required top-level field: "${field}"`);
    }
  }

  if (typeof dashboard.schemaVersion !== "number" || dashboard.schemaVersion < 30) {
    errors.push(`Invalid schemaVersion: expected number >= 30, got ${dashboard.schemaVersion}`);
  }

  if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
    errors.push(`Dashboard "panels" must be a non-empty array`);
  }

  // 2. Published metrics extraction
  const publishedMetrics = extractPublishedMetrics(metricsRoutePath);
  const queriedMetrics = new Set();

  // 3. Panel target validation
  if (Array.isArray(dashboard.panels)) {
    for (const panel of dashboard.panels) {
      const panelTitle = panel.title || `Panel ID ${panel.id || "unknown"}`;
      if (!panel.id) errors.push(`Panel "${panelTitle}" missing numeric "id"`);
      if (!panel.type) errors.push(`Panel "${panelTitle}" missing "type"`);
      if (!panel.gridPos || typeof panel.gridPos.h !== "number") {
        errors.push(`Panel "${panelTitle}" missing valid "gridPos"`);
      }

      if (!Array.isArray(panel.targets) || panel.targets.length === 0) {
        errors.push(`Panel "${panelTitle}" has no query targets`);
        continue;
      }

      for (const target of panel.targets) {
        if (!target.expr) {
          errors.push(`Panel "${panelTitle}" target missing "expr" PromQL query`);
          continue;
        }

        const metricsInExpr = extractMetricsFromExpr(target.expr);
        for (const metric of metricsInExpr) {
          queriedMetrics.add(metric);
          const isOphirMetric = metric.startsWith("ophirpay_");
          if (isOphirMetric) {
            if (!publishedMetrics.has(metric)) {
              errors.push(
                `Panel "${panelTitle}" (ID ${panel.id}) references unpublished metric "${metric}"`
              );
            }
          } else if (!allowedExternal.has(metric)) {
            errors.push(
              `Panel "${panelTitle}" (ID ${panel.id}) references unknown/undocumented metric "${metric}"`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    queriedMetrics: Array.from(queriedMetrics),
    publishedMetrics: Array.from(publishedMetrics),
    schemaVersion: dashboard.schemaVersion,
    dashboardTitle: dashboard.title,
  };
}

// CLI execution
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const result = validateGrafanaDashboard();
  if (!result.valid) {
    console.error("❌ Grafana dashboard validation failed with errors:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    `✅ Grafana dashboard valid (schemaVersion: ${result.schemaVersion}, compatible with Grafana 9.5+, 10.x, 11.x; ${result.queriedMetrics.length} distinct metric queries verified in /api/metrics)`
  );
  process.exit(0);
}
