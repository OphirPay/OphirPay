// SPDX-License-Identifier: MIT

/**
 * Issue #755 — Grafana Dashboard Validation & Metrics Sync Test Suite
 *
 * Verifies that:
 * 1. monitoring/grafana-dashboard.json is valid JSON with required top-level schema fields.
 * 2. The dashboard documents compatibility with specific Grafana versions (schemaVersion: 39, Grafana 9.5+, 10.x, 11.x).
 * 3. Every panel contains valid structure (id, title, type, gridPos, targets).
 * 4. Every metric queried in panel PromQL targets is published by src/app/api/metrics/route.ts.
 * 5. Corrupted JSON, missing required fields, or unpublished metric queries fail CI with descriptive errors.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import path from "path";
import {
  validateGrafanaDashboard,
  extractPublishedMetrics,
  extractMetricsFromExpr,
  REQUIRED_TOP_LEVEL_FIELDS,
} from "../../scripts/validate-grafana-dashboard.mjs";

const ROOT = process.cwd();
const DASHBOARD_PATH = path.join(ROOT, "monitoring/grafana-dashboard.json");
const METRICS_ROUTE_PATH = path.join(ROOT, "src/app/api/metrics/route.ts");

describe("Grafana dashboard schema & metrics synchronization (Issue #755)", () => {
  it("passes validation for the committed monitoring/grafana-dashboard.json", () => {
    const result = validateGrafanaDashboard({
      dashboardPath: DASHBOARD_PATH,
      metricsRoutePath: METRICS_ROUTE_PATH,
    });

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.schemaVersion).toBe(39);
    expect(result.queriedMetrics.length).toBeGreaterThanOrEqual(6);
  });

  it("documents Grafana version compatibility in dashboard metadata", () => {
    const raw = readFileSync(DASHBOARD_PATH, "utf8");
    const dashboard = JSON.parse(raw);

    expect(dashboard.schemaVersion).toBe(39);
    expect(dashboard.description).toMatch(/Grafana 10\.x/i);
    expect(dashboard.description).toMatch(/schemaVersion 39/i);
  });

  it("extracts all published metrics from src/app/api/metrics/route.ts", () => {
    const metrics = extractPublishedMetrics(METRICS_ROUTE_PATH);

    expect(metrics.has("ophirpay_http_requests_total")).toBe(true);
    expect(metrics.has("ophirpay_payments_created_total")).toBe(true);
    expect(metrics.has("ophirpay_payments_failed_total")).toBe(true);
    expect(metrics.has("ophirpay_batches_processed_total")).toBe(true);
    expect(metrics.has("ophirpay_webhooks_delivered_total")).toBe(true);
    expect(metrics.has("ophirpay_webhooks_failed_total")).toBe(true);
    expect(metrics.has("ophirpay_db_query_duration_seconds_sum")).toBe(true);
    expect(metrics.has("ophirpay_db_query_duration_seconds_count")).toBe(true);
  });

  it("correctly tokenizes PromQL queries without confusing duration literals or keywords", () => {
    const expr1 = "rate(ophirpay_http_requests_total[5m])";
    expect(extractMetricsFromExpr(expr1)).toEqual(["ophirpay_http_requests_total"]);

    const expr2 =
      "ophirpay_db_query_duration_seconds_sum / ophirpay_db_query_duration_seconds_count";
    expect(extractMetricsFromExpr(expr2)).toEqual([
      "ophirpay_db_query_duration_seconds_sum",
      "ophirpay_db_query_duration_seconds_count",
    ]);

    const expr3 =
      'sum(rate(ophirpay_payments_created_total{status="COMPLETED"}[1h])) by (asset)';
    expect(extractMetricsFromExpr(expr3)).toEqual(["ophirpay_payments_created_total"]);
  });

  it("fails validation when dashboard JSON is malformed", () => {
    const tmpFile = path.join(ROOT, "monitoring/test-malformed-dashboard.json");
    try {
      writeFileSync(tmpFile, "{ this is not valid json }", "utf8");
      const result = validateGrafanaDashboard({
        dashboardPath: tmpFile,
        metricsRoutePath: METRICS_ROUTE_PATH,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/Malformed JSON/i);
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  });

  it("fails validation when required top-level fields are missing", () => {
    const original = JSON.parse(readFileSync(DASHBOARD_PATH, "utf8"));
    const tmpFile = path.join(ROOT, "monitoring/test-missing-fields-dashboard.json");

    for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
      try {
        const copy = { ...original };
        delete copy[field];
        writeFileSync(tmpFile, JSON.stringify(copy), "utf8");

        const result = validateGrafanaDashboard({
          dashboardPath: tmpFile,
          metricsRoutePath: METRICS_ROUTE_PATH,
        });

        expect(result.valid).toBe(false);
        expect(
          result.errors.some((err: string) => err.includes(`missing required top-level field: "${field}"`))
        ).toBe(true);
      } finally {
        try {
          unlinkSync(tmpFile);
        } catch {
          // ignore
        }
      }
    }
  });

  it("fails validation with panel title and metric name when querying an unpublished metric", () => {
    const original = JSON.parse(readFileSync(DASHBOARD_PATH, "utf8"));
    const tmpFile = path.join(ROOT, "monitoring/test-unpublished-metric-dashboard.json");

    try {
      const copy = { ...original };
      copy.panels = [
        {
          id: 99,
          title: "Stray Metric Panel",
          type: "timeseries",
          gridPos: { h: 8, w: 12, x: 0, y: 0 },
          targets: [
            { expr: "rate(ophirpay_nonexistent_custom_metric_total[5m])" },
          ],
        },
      ];
      writeFileSync(tmpFile, JSON.stringify(copy), "utf8");

      const result = validateGrafanaDashboard({
        dashboardPath: tmpFile,
        metricsRoutePath: METRICS_ROUTE_PATH,
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (err: string) =>
            err.includes('Panel "Stray Metric Panel"') &&
            err.includes('ID 99') &&
            err.includes('ophirpay_nonexistent_custom_metric_total')
        )
      ).toBe(true);
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  });
});
