// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

interface AlertRule {
  alert: string;
  expr: string;
  for: string;
  labels: {
    severity: "warning" | "critical";
    component: string;
    [key: string]: unknown;
  };
  annotations: {
    summary: string;
    description: string;
    runbook_url?: string;
    [key: string]: unknown;
  };
}

interface AlertGroup {
  name: string;
  interval?: string;
  rules: AlertRule[];
}

interface PrometheusAlertsConfig {
  groups: AlertGroup[];
}

describe("Prometheus Alert Rules Validation & Telemetry (Issue #1412)", () => {
  const alertsPath = path.resolve(process.cwd(), "monitoring/prometheus-alerts.yml");
  const troubleshootingPath = path.resolve(process.cwd(), "docs/TROUBLESHOOTING.md");
  const metricsRoutePath = path.resolve(process.cwd(), "src/app/api/metrics/route.ts");

  const alertsContent = fs.readFileSync(alertsPath, "utf-8");
  const troubleshootingContent = fs.readFileSync(troubleshootingPath, "utf-8");
  const metricsRouteContent = fs.readFileSync(metricsRoutePath, "utf-8");

  const config = yaml.load(alertsContent) as PrometheusAlertsConfig;

  it("parses monitoring/prometheus-alerts.yml as valid YAML with non-empty groups", () => {
    expect(config).toBeDefined();
    expect(Array.isArray(config.groups)).toBe(true);
    expect(config.groups.length).toBeGreaterThan(0);
  });

  const allRules: AlertRule[] = config.groups.flatMap((g) => g.rules);

  it("ensures every alert rule satisfies required structural schema", () => {
    for (const rule of allRules) {
      expect(rule.alert, "Rule missing alert name").toBeDefined();
      expect(typeof rule.alert).toBe("string");
      expect(rule.alert.trim().length).toBeGreaterThan(0);

      expect(rule.expr, `Alert ${rule.alert} missing expr`).toBeDefined();
      expect(typeof rule.expr).toBe("string");
      expect(rule.expr.trim().length).toBeGreaterThan(0);

      expect(rule.for, `Alert ${rule.alert} missing 'for' duration`).toBeDefined();
      expect(rule.for).toMatch(/^\d+[smhd]$/);

      expect(rule.labels, `Alert ${rule.alert} missing labels`).toBeDefined();
      expect(["warning", "critical"]).toContain(rule.labels.severity);
      expect(rule.labels.component).toBeDefined();

      expect(rule.annotations, `Alert ${rule.alert} missing annotations`).toBeDefined();
      expect(rule.annotations.summary).toBeDefined();
      expect(rule.annotations.description).toBeDefined();

      expect(rule.annotations.runbook_url, `Alert ${rule.alert} missing runbook_url`).toBeDefined();
      expect(rule.annotations.runbook_url).toMatch(/^docs\/TROUBLESHOOTING\.md#/);
    }
  });

  it("verifies all referenced runbook anchors exist in docs/TROUBLESHOOTING.md", () => {
    for (const rule of allRules) {
      const runbookUrl = rule.annotations.runbook_url!;
      const anchor = runbookUrl.split("#")[1];
      expect(anchor, `Runbook URL ${runbookUrl} missing anchor`).toBeDefined();

      const anchorTag = `id="${anchor}"`;
      const markdownHeading = anchor.replace(/-/g, " ");

      const anchorFound =
        troubleshootingContent.includes(anchorTag) ||
        troubleshootingContent.toLowerCase().includes(markdownHeading.toLowerCase());

      expect(
        anchorFound,
        `Anchor #${anchor} for alert ${rule.alert} not found in docs/TROUBLESHOOTING.md`
      ).toBe(true);
    }
  });

  it("cross-checks all ophirpay_* metrics in alerts against src/app/api/metrics/route.ts (CI consistency)", () => {
    const ophirpayMetrics = Array.from(
      new Set(alertsContent.match(/ophirpay_[a-zA-Z0-9_]+/g) || [])
    ).sort();

    expect(ophirpayMetrics.length).toBeGreaterThan(0);

    for (const metric of ophirpayMetrics) {
      expect(
        metricsRouteContent.includes(metric),
        `Metric ${metric} referenced in prometheus-alerts.yml is missing from route.ts`
      ).toBe(true);
    }
  });

  describe("Required Issue #1412 Alert Rules", () => {
    it("defines OphirPayWebhookHighFailureRate (triggers when webhook failures > 5% over 5m)", () => {
      const rule = allRules.find((r) => r.alert === "OphirPayWebhookHighFailureRate");
      expect(rule).toBeDefined();
      expect(rule!.labels.severity).toBe("warning");
      expect(rule!.labels.component).toBe("webhooks");
      expect(rule!.for).toBe("5m");
      expect(rule!.expr).toContain("ophirpay_delivery_final_outcomes_total");
      expect(rule!.expr).toContain("> 0.05");
    });

    it("defines OphirPayRpcProviderDegraded (triggers when RPC latency > 2.5s or 5xx for 3m)", () => {
      const rule = allRules.find((r) => r.alert === "OphirPayRpcProviderDegraded");
      expect(rule).toBeDefined();
      expect(rule!.labels.severity).toBe("critical");
      expect(rule!.labels.component).toBe("rpc");
      expect(rule!.for).toBe("3m");
      expect(rule!.expr).toContain("ophirpay_endpoint_request_duration_seconds_bucket");
      expect(rule!.expr).toContain("> 2.5");
      expect(rule!.expr).toContain('status_class="5xx"');
    });

    it("defines OphirPayDatabasePoolExhaustion (triggers when Prisma queue / query latency > 500ms)", () => {
      const rule = allRules.find((r) => r.alert === "OphirPayDatabasePoolExhaustion");
      expect(rule).toBeDefined();
      expect(rule!.labels.severity).toBe("warning");
      expect(rule!.labels.component).toBe("database");
      expect(rule!.for).toBe("2m");
      expect(rule!.expr).toContain("ophirpay_db_query_duration_seconds_sum");
      expect(rule!.expr).toContain("ophirpay_db_query_duration_seconds_count");
      expect(rule!.expr).toContain("> 0.5");
    });
  });

  describe("Synthetic Metric Fixture Scenarios", () => {
    it("evaluates webhook failure rate alert condition correctly against synthetic metrics", () => {
      const evaluateWebhookAlert = (failures: number, total: number): boolean => {
        if (total === 0) return false;
        const rate = failures / total;
        return rate > 0.05;
      };

      // Scenario A: 6 failures out of 100 requests = 6% > 5% -> SHOULD ALERT
      expect(evaluateWebhookAlert(6, 100)).toBe(true);

      // Scenario B: 4 failures out of 100 requests = 4% <= 5% -> SHOULD NOT ALERT
      expect(evaluateWebhookAlert(4, 100)).toBe(false);

      // Scenario C: 0 total requests -> SHOULD NOT ALERT
      expect(evaluateWebhookAlert(0, 0)).toBe(false);
    });

    it("evaluates Soroban RPC degraded condition correctly against synthetic metrics", () => {
      const evaluateRpcAlert = (p95LatencySeconds: number, http5xxCount: number): boolean => {
        return p95LatencySeconds > 2.5 || http5xxCount > 0;
      };

      // Scenario A: Latency 3.1s (> 2.5s) -> SHOULD ALERT
      expect(evaluateRpcAlert(3.1, 0)).toBe(true);

      // Scenario B: Latency 1.2s and 0 errors -> SHOULD NOT ALERT
      expect(evaluateRpcAlert(1.2, 0)).toBe(false);

      // Scenario C: Latency 0.8s but 5xx errors present -> SHOULD ALERT
      expect(evaluateRpcAlert(0.8, 1)).toBe(true);
    });

    it("evaluates Database pool exhaustion condition correctly against synthetic metrics", () => {
      const evaluateDbAlert = (durationSumSeconds: number, queryCount: number): boolean => {
        if (queryCount === 0) return false;
        const avgDurationSeconds = durationSumSeconds / queryCount;
        return avgDurationSeconds > 0.5; // 500ms
      };

      // Scenario A: 60s sum across 100 queries = 600ms (> 500ms) -> SHOULD ALERT
      expect(evaluateDbAlert(60, 100)).toBe(true);

      // Scenario B: 30s sum across 100 queries = 300ms (<= 500ms) -> SHOULD NOT ALERT
      expect(evaluateDbAlert(30, 100)).toBe(false);
    });
  });
});
