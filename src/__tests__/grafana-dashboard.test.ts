// SPDX-License-Identifier: MIT
//
// Unit tests for scripts/validate-grafana-dashboard.mjs — the Grafana
// dashboard JSON ⇄ /api/metrics validator (issue #755).

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPORTED_SCHEMA_VERSION,
  collectDashboardMetricReferences,
  extractExposedMetrics,
  extractPromqlMetricNames,
  runValidation,
  validateDashboardShape,
} from "../../scripts/validate-grafana-dashboard.mjs";

// The validator is a plain .mjs script (no TS types); the shapes below are
// the ones it actually produces/consumes.
type MetricReference = { panel: string; metric: string; expr: string };
type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: { panels: number; references: number; uniqueMetrics: number; exposedMetrics: number };
};

const ROOT = process.cwd();
const scriptPath = join(ROOT, "scripts", "validate-grafana-dashboard.mjs");
const dashboardPath = join(ROOT, "monitoring", "grafana-dashboard.json");
const metricsRoutePath = join(ROOT, "src", "app", "api", "metrics", "route.ts");
const dashboardSource = readFileSync(dashboardPath, "utf8");
const metricsRouteSource = readFileSync(metricsRoutePath, "utf8");

const fixturePath = (name: string) => join(ROOT, "tests", "fixtures", "grafana", name);

function runCli(args: string[] = []): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("extractPromqlMetricNames", () => {
  it("extracts a bare metric selector", () => {
    expect(extractPromqlMetricNames("ophirpay_http_requests_total")).toEqual([
      "ophirpay_http_requests_total",
    ]);
  });

  it("extracts the metric inside a range-vector function call", () => {
    expect(extractPromqlMetricNames("rate(ophirpay_http_requests_total[5m])")).toEqual([
      "ophirpay_http_requests_total",
    ]);
  });

  it("extracts both metrics from a division expression", () => {
    expect(
      extractPromqlMetricNames(
        "ophirpay_db_query_duration_seconds_sum / ophirpay_db_query_duration_seconds_count"
      )
    ).toEqual([
      "ophirpay_db_query_duration_seconds_sum",
      "ophirpay_db_query_duration_seconds_count",
    ]);
  });

  it("ignores aggregation keywords, group labels and durations", () => {
    expect(
      extractPromqlMetricNames("sum by (job) (rate(ophirpay_batches_processed_total[5m]))")
    ).toEqual(["ophirpay_batches_processed_total"]);
  });

  it("ignores label names and values inside selector braces", () => {
    expect(
      extractPromqlMetricNames('ophirpay_http_requests_total{job="worker",le="0.5"}')
    ).toEqual(["ophirpay_http_requests_total"]);
  });
});

describe("extractExposedMetrics", () => {
  it("finds declared and emitted metrics in the metrics route", () => {
    const exposed = extractExposedMetrics(metricsRouteSource) as Set<string>;
    for (const metric of [
      "ophirpay_http_requests_total",
      "ophirpay_payments_created_total",
      "ophirpay_db_query_duration_seconds_sum",
      "ophirpay_db_query_duration_seconds_count",
      "ophirpay_endpoint_request_duration_seconds_bucket",
      "ophirpay_info",
    ]) {
      expect(exposed.has(metric), `${metric} should be exposed`).toBe(true);
    }
    expect(exposed.has("HELP")).toBe(false);
  });
});

describe("validateDashboardShape", () => {
  it("accepts the checked-in dashboard", () => {
    const dashboard = JSON.parse(dashboardSource);
    expect(validateDashboardShape(dashboard)).toEqual([]);
  });

  it("reports a missing required top-level field by name", () => {
    const dashboard = JSON.parse(dashboardSource);
    delete dashboard.templating;
    const errors = validateDashboardShape(dashboard) as string[];
    expect(errors.some((error) => error.includes('"templating"'))).toBe(true);
  });

  it("reports a schemaVersion that is not the supported one", () => {
    const dashboard = JSON.parse(dashboardSource);
    dashboard.schemaVersion = 41;
    const errors = validateDashboardShape(dashboard) as string[];
    expect(errors.some((error) => error.includes("schemaVersion 41"))).toBe(true);
    expect(errors.some((error) => error.includes(String(SUPPORTED_SCHEMA_VERSION)))).toBe(true);
  });

  it("reports panels that are not an array", () => {
    const dashboard = JSON.parse(dashboardSource);
    dashboard.panels = {};
    const errors = validateDashboardShape(dashboard) as string[];
    expect(errors.some((error) => error.includes('"panels"'))).toBe(true);
  });
});

describe("dashboard ⇄ metrics sync", () => {
  it("collects one reference per metric per target, with the panel label", () => {
    const dashboard = JSON.parse(dashboardSource);
    const references = collectDashboardMetricReferences(dashboard) as MetricReference[];
    const dbCount = references.filter(
      (reference) => reference.metric === "ophirpay_db_query_duration_seconds_count"
    );
    expect(dbCount).toHaveLength(1);
    expect(dbCount[0].panel).toContain("Database Query Latency");
  });

  it("accepts the checked-in dashboard against the real metrics route", () => {
    const result = runValidation(dashboardSource, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stats.references).toBeGreaterThanOrEqual(8);
  });

  it("fails a panel that queries an unpublished metric, naming the panel and the metric", () => {
    const dashboard = JSON.parse(dashboardSource);
    dashboard.panels.push({
      id: 99,
      title: "Renamed Metric Panel",
      type: "timeseries",
      targets: [{ expr: "rate(ophirpay_renamed_metric_total[5m])" }],
    });
    const result = runValidation(JSON.stringify(dashboard), metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(false);
    const message = result.errors.join("\n");
    expect(message).toContain('"Renamed Metric Panel"');
    expect(message).toContain("ophirpay_renamed_metric_total");
  });

  it("does not match metrics by prefix (strict check, no allowlist)", () => {
    const dashboard = JSON.parse(dashboardSource);
    dashboard.panels.push({
      id: 100,
      title: "Lookalike Panel",
      type: "timeseries",
      targets: [{ expr: "ophirpay_http_requests_total_bytes" }],
    });
    const result = runValidation(JSON.stringify(dashboard), metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("ophirpay_http_requests_total_bytes");
  });
});

describe("CLI contract (node scripts/validate-grafana-dashboard.mjs)", () => {
  it("exits 0 and reports the metric references for the checked-in dashboard", () => {
    const { status, stdout } = runCli();
    expect(status).toBe(0);
    expect(stdout).toContain("metric reference");
  });

  it("exits 1 on malformed JSON", () => {
    const { status, stderr } = runCli(["--dashboard", fixturePath("malformed.json")]);
    expect(status).toBe(1);
    expect(stderr).toContain("malformed");
  });

  it("exits 1 on a missing required top-level field", () => {
    const { status, stderr } = runCli(["--dashboard", fixturePath("missing-field.json")]);
    expect(status).toBe(1);
    expect(stderr).toContain('"templating"');
  });

  it("exits 1 naming the panel and metric for a query on an unpublished metric", () => {
    const { status, stderr } = runCli(["--dashboard", fixturePath("unpublished-metric.json")]);
    expect(status).toBe(1);
    expect(stderr).toContain('"Renamed Metric Panel"');
    expect(stderr).toContain("ophirpay_nonexistent_metric_total");
  });
});

describe("documented Grafana compatibility", () => {
  it("pins the checked-in dashboard to the supported schemaVersion", () => {
    const dashboard = JSON.parse(dashboardSource);
    expect(dashboard.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
  });

  it("documents the targeted Grafana version in monitoring/README.md", () => {
    const readme = readFileSync(join(ROOT, "monitoring", "README.md"), "utf8");
    expect(readme).toContain(`schemaVersion ${SUPPORTED_SCHEMA_VERSION}`);
    expect(readme).toMatch(/Grafana 11\.x/);
  });
});
