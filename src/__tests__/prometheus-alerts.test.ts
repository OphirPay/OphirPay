// SPDX-License-Identifier: MIT
//
// Unit tests for scripts/validate-monitoring.mjs — the Prometheus alert-rule
// ⇄ /api/metrics cross-check (issue #754).

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectAlertRules,
  extractExposedMetrics,
  extractPromqlMetricNames,
  parseExternalDeclaration,
  validateAlertRules,
} from "../../scripts/validate-monitoring.mjs";

// The validator is a plain .mjs script (no TS types); the shapes below are
// the ones it actually produces/consumes.
type AlertEntry = { kind: string; name: string; external: Set<string>; expr: string | null };
type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    alerts: number;
    references: number;
    uniqueMetrics: number;
    externalMetrics: number;
    exposedMetrics: number;
  };
};

const ROOT = process.cwd();
const scriptPath = join(ROOT, "scripts", "validate-monitoring.mjs");
const rulesPath = join(ROOT, "monitoring", "prometheus-alerts.yml");
const metricsRoutePath = join(ROOT, "src", "app", "api", "metrics", "route.ts");
const rulesSource = readFileSync(rulesPath, "utf8");
const metricsRouteSource = readFileSync(metricsRoutePath, "utf8");

const fixturePath = (name: string) => join(ROOT, "tests", "fixtures", "prometheus", name);

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

/** The real rules file with one line removed, so the checked-in file stays untouched. */
function rulesWithout(line: string): string {
  const lines = rulesSource.split("\n");
  const index = lines.indexOf(line);
  expect(index, `line should exist in the rules file: ${line}`).toBeGreaterThanOrEqual(0);
  return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
}

describe("extractPromqlMetricNames", () => {
  it("extracts a bare metric selector", () => {
    expect(extractPromqlMetricNames("ophirpay_webhook_queue_depth > 1000")).toEqual([
      "ophirpay_webhook_queue_depth",
    ]);
  });

  it("extracts the metric inside a range-vector function call", () => {
    expect(extractPromqlMetricNames("rate(ophirpay_http_requests_total[5m])")).toEqual([
      "ophirpay_http_requests_total",
    ]);
  });

  it("ignores label names and values inside selector braces", () => {
    expect(extractPromqlMetricNames('up{job="ophirpay"} == 0')).toEqual(["up"]);
    expect(
      extractPromqlMetricNames(
        'rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook",final_outcome="failure"}[15m])'
      )
    ).toEqual(["ophirpay_delivery_final_outcomes_total"]);
  });

  it("extracts both metrics from a division expression", () => {
    expect(
      extractPromqlMetricNames(
        "rate(ophirpay_batch_failed_items[15m]) / rate(ophirpay_batch_total_items[15m]) > 0.5"
      )
    ).toEqual(["ophirpay_batch_failed_items", "ophirpay_batch_total_items"]);
  });

  it("extracts the histogram metric from histogram_quantile()", () => {
    expect(
      extractPromqlMetricNames(
        "histogram_quantile(0.95, rate(ophirpay_db_query_duration_seconds_bucket[5m])) > 1"
      )
    ).toEqual(["ophirpay_db_query_duration_seconds_bucket"]);
  });

  it("ignores aggregation keywords, group labels and durations", () => {
    expect(
      extractPromqlMetricNames("sum by (job, instance) (rate(ophirpay_http_requests_total[5m]))")
    ).toEqual(["ophirpay_http_requests_total"]);
  });

  it("ignores clamp_min() and de-duplicates repeated selectors", () => {
    expect(
      extractPromqlMetricNames(
        'sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook",final_outcome="failure"}[15m])) / clamp_min(sum(rate(ophirpay_delivery_final_outcomes_total{delivery_type="webhook"}[15m])), 1) > 0.25'
      )
    ).toEqual(["ophirpay_delivery_final_outcomes_total"]);
  });

  it("returns nothing for an empty expression", () => {
    expect(extractPromqlMetricNames("")).toEqual([]);
  });
});

describe("extractExposedMetrics", () => {
  it("finds declared and emitted metrics in the metrics route", () => {
    const exposed = extractExposedMetrics(metricsRouteSource) as Set<string>;
    for (const metric of [
      "ophirpay_http_requests_total",
      "ophirpay_delivery_final_outcomes_total",
      "ophirpay_endpoint_errors_total",
      "ophirpay_endpoint_request_duration_seconds_bucket",
      "ophirpay_db_query_duration_seconds_count",
      "ophirpay_info",
    ]) {
      expect(exposed.has(metric), `${metric} should be exposed`).toBe(true);
    }
  });

  it("does not report metrics the app never publishes, and no HELP/TYPE tokens", () => {
    const exposed = extractExposedMetrics(metricsRouteSource) as Set<string>;
    for (const metric of [
      "ophirpay_contract_balance",
      "ophirpay_http_errors_total",
      "ophirpay_db_query_duration_seconds_bucket",
    ]) {
      expect(exposed.has(metric), `${metric} should not be exposed`).toBe(false);
    }
    expect(exposed.has("HELP")).toBe(false);
    expect(exposed.has("TYPE")).toBe(false);
  });
});

describe("parseExternalDeclaration", () => {
  it("parses a comma-separated metric list", () => {
    expect(parseExternalDeclaration("ophirpay_contract_balance, ophirpay_locked_balance")).toEqual({
      metrics: ["ophirpay_contract_balance", "ophirpay_locked_balance"],
      error: null,
    });
  });

  it("reports a malformed declaration instead of ignoring it", () => {
    const { metrics, error } = parseExternalDeclaration("ophirpay_contract_balance + oops") as {
      metrics: string[];
      error: string | null;
    };
    expect(metrics).toEqual([]);
    expect(error).toContain("malformed");
  });
});

describe("collectAlertRules", () => {
  it("collects every alert of the checked-in rules file, in order", () => {
    const { entries, errors } = collectAlertRules(rulesSource) as {
      entries: AlertEntry[];
      errors: string[];
    };
    expect(errors).toEqual([]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "ContractBalanceBelowLocked",
      "ContractBalanceDroppingFast",
      "LockedBalanceDivergence",
      "BatchPaymentFailureRateHigh",
      "PaymentProcessingLatencyHigh",
      "WebhookDeliveryFailureRateHigh",
      "WebhookQueueDepthHigh",
      "ApiHighErrorRate",
      "ApiDown",
      "DatabaseConnectionPoolExhausted",
      "DatabaseQueryLatencyHigh",
      "RateLimitHitsHigh",
    ]);
    expect(entries.every((entry) => entry.kind === "alert")).toBe(true);
  });

  it("attaches the declarations written inside an alert block to that alert", () => {
    const { entries } = collectAlertRules(rulesSource) as { entries: AlertEntry[] };
    const belowLocked = entries.find((entry) => entry.name === "ContractBalanceBelowLocked");
    const divergence = entries.find((entry) => entry.name === "LockedBalanceDivergence");
    expect([...belowLocked!.external]).toEqual([
      "ophirpay_contract_balance",
      "ophirpay_locked_balance",
    ]);
    expect([...divergence!.external]).toEqual([
      "ophirpay_contract_balance",
      "ophirpay_locked_balance",
      "ophirpay_unlocked_balance",
    ]);
  });

  it("reports a declaration written outside any alert block", () => {
    const { errors } = collectAlertRules("# external: ophirpay_contract_balance\ngroups: []\n") as {
      errors: string[];
    };
    expect(errors.some((error) => error.includes("must live inside the alert block"))).toBe(true);
  });
});

describe("contract-balance alerts (issue #754 acceptance criteria)", () => {
  it("accounts for the two contract-balance alerts instead of failing on them", () => {
    const result = validateAlertRules(rulesSource, metricsRouteSource) as ValidationResult;
    const mentions = (name: string) => result.errors.filter((error) => error.includes(`"${name}"`));
    expect(mentions("ContractBalanceBelowLocked")).toEqual([]);
    expect(mentions("LockedBalanceDivergence")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails naming ContractBalanceBelowLocked and its metric once its declaration is removed", () => {
    const rules = rulesWithout(
      "        # external: ophirpay_contract_balance, ophirpay_locked_balance"
    );
    const result = validateAlertRules(rules, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(false);
    const message = result.errors.join("\n");
    expect(message).toContain('alert "ContractBalanceBelowLocked"');
    expect(message).toContain('"ophirpay_contract_balance"');
    expect(message).toContain('"ophirpay_locked_balance"');
  });

  it("fails naming LockedBalanceDivergence and its metrics once its declaration is removed", () => {
    const rules = rulesWithout(
      "        # external: ophirpay_contract_balance, ophirpay_locked_balance, ophirpay_unlocked_balance"
    );
    const result = validateAlertRules(rules, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(false);
    const message = result.errors.join("\n");
    expect(message).toContain('alert "LockedBalanceDivergence"');
    expect(message).toContain('"ophirpay_unlocked_balance"');
    expect(message).toContain('"ophirpay_contract_balance"');
  });
});

describe("alert rules ⇄ metrics sync", () => {
  it("accepts the checked-in rules against the real metrics route", () => {
    const result = validateAlertRules(rulesSource, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stats.alerts).toBe(12);
    expect(result.stats.references).toBeGreaterThanOrEqual(17);
    expect(result.stats.uniqueMetrics).toBeGreaterThanOrEqual(14);
    expect(result.stats.externalMetrics).toBe(12);
    expect(result.stats.exposedMetrics).toBe(2);
  });

  it("fails a renamed app metric, naming the alert and the metric", () => {
    const rules = rulesSource.replace(
      "rate(ophirpay_http_requests_total[5m])",
      "rate(ophirpay_http_requests_renamed_total[5m])"
    );
    expect(rules).not.toBe(rulesSource);
    const result = validateAlertRules(rules, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(false);
    const message = result.errors.join("\n");
    expect(message).toContain('alert "ApiHighErrorRate"');
    expect(message).toContain('"ophirpay_http_requests_renamed_total"');
  });

  it("warns when a declaration contradicts the metrics route", () => {
    const rules = rulesSource.replace(
      "        # external: ophirpay_http_errors_total\n",
      "        # external: ophirpay_http_errors_total, ophirpay_http_requests_total\n"
    );
    const result = validateAlertRules(rules, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("exposes it");
    expect(result.warnings.join("\n")).toContain("ophirpay_http_requests_total");
  });

  it("warns about a stale declaration that no expression references", () => {
    const rules = rulesSource.replace(
      "        # external: ophirpay_contract_balance\n",
      "        # external: ophirpay_contract_balance, ophirpay_unlocked_balance\n"
    );
    const result = validateAlertRules(rules, metricsRouteSource) as ValidationResult;
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("stale declaration");
  });
});

describe("CLI contract (node scripts/validate-monitoring.mjs)", () => {
  it("exits 0 and reports the metric references for the checked-in rules", () => {
    const { status, stdout } = runCli();
    expect(status).toBe(0);
    expect(stdout).toContain("12 alert rule(s) checked");
    expect(stdout).toContain("12 declared external");
  });

  it("exits 1 naming the alert and the metric for an undeclared selector", () => {
    const { status, stderr } = runCli(["--rules", fixturePath("undeclared-metric.yml")]);
    expect(status).toBe(1);
    expect(stderr).toContain('alert "RenamedMetricAlert"');
    expect(stderr).toContain('"ophirpay_http_requestz_total"');
  });

  it("exits 1 on a misplaced external declaration", () => {
    const { status, stderr } = runCli(["--rules", fixturePath("misplaced-declaration.yml")]);
    expect(status).toBe(1);
    expect(stderr).toContain("must live inside the alert block");
  });

  it("exits 0 on a valid fixture passed through --rules", () => {
    const { status } = runCli(["--rules", fixturePath("valid-external.yml")]);
    expect(status).toBe(0);
  });

  it("prints the usage and exits 0 on --help", () => {
    const { status, stdout } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage: node scripts/validate-monitoring.mjs");
  });

  it("rejects unknown arguments", () => {
    const { status, stderr } = runCli(["--nope"]);
    expect(status).toBe(1);
    expect(stderr).toContain('unknown argument "--nope"');
  });
});

describe("CI workflow contract", () => {
  it("runs promtool with --lint-fatal so duplicate rules fail the job", () => {
    const workflow = readFileSync(
      join(ROOT, ".github", "workflows", "prometheus-rules-validation.yml"),
      "utf8"
    );
    expect(workflow).toContain(
      "promtool check rules --lint-fatal monitoring/prometheus-alerts.yml"
    );
    expect(workflow).toContain("node scripts/validate-monitoring.mjs");
  });
});

describe("documented external-metric convention", () => {
  it("documents the # external: convention in the rules file header", () => {
    expect(rulesSource.split("\n").slice(0, 20).join("\n")).toContain("# external: <metric>");
  });

  it("documents the convention in docs/metrics-endpoints.md", () => {
    const doc = readFileSync(join(ROOT, "docs", "metrics-endpoints.md"), "utf8");
    expect(doc).toContain("# external:");
    expect(doc).toContain("validate-monitoring.mjs");
  });
});
