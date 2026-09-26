// SPDX-License-Identifier: MIT
//
// Content tests for Prometheus and Grafana observability documentation (issue #783).
// Verifies dashboard import instructions, scrape auth, Alertmanager routing,
// and step-by-step incident response runbooks for all alert rules.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "OBSERVABILITY.md");
const alertsPath = path.join(root, "monitoring", "prometheus-alerts.yml");
const dashboardPath = path.join(root, "monitoring", "grafana-dashboard.json");
const metricsEndpointsDocPath = path.join(root, "docs", "metrics-endpoints.md");
const readmePath = path.join(root, "README.md");

describe("docs/OBSERVABILITY.md (Grafana dashboard & Prometheus alerts)", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("documents scrape configuration and auth requirements for /api/metrics", () => {
    expect(doc).toMatch(/\/api\/metrics/);
    expect(doc).toMatch(/METRICS_TOKEN/);
    expect(doc).toMatch(/401 Unauthorized/);
    expect(doc).toMatch(/Authorization: Bearer/);
    expect(doc).toMatch(/scrape_configs:/);
  });

  it("documents Grafana dashboard import, schema version, and required datasource UID", () => {
    expect(doc).toMatch(/monitoring\/grafana-dashboard\.json/);
    expect(doc).toMatch(/schemaVersion:\s*39/);
    expect(doc).toMatch(/10\.x/);
    expect(doc).toMatch(/11\.x/);
    expect(doc).toMatch(/prometheus/);
  });

  it("documents Alertmanager routing configuration", () => {
    expect(doc).toMatch(/alertmanager\.yml/);
    expect(doc).toMatch(/pagerduty/i);
    expect(doc).toMatch(/slack/i);
    expect(doc).toMatch(/severity:\s*critical/);
    expect(doc).toMatch(/severity:\s*warning/);
  });

  it("documents runbooks for every alert defined in monitoring/prometheus-alerts.yml", () => {
    const alertsYaml = existsSync(alertsPath) ? readFileSync(alertsPath, "utf8") : "";
    const alertMatches = alertsYaml.matchAll(/alert:\s*([A-Za-z0-9_]+)/g);
    const alertNames = Array.from(alertMatches, (m) => m[1]);

    expect(alertNames.length).toBeGreaterThan(0);
    expect(alertNames).toEqual(
      expect.arrayContaining([
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
      ])
    );

    for (const alertName of alertNames) {
      expect(doc).toContain(alertName);
    }
  });

  it("documents emergency contract pause command and blast radius for ContractBalanceBelowLocked", () => {
    expect(doc).toMatch(/emergency_pause_all/);
    expect(doc).toMatch(/Blast Radius/i);
    expect(doc).toMatch(/\/pause-controls/);
  });
});

describe("observability references and dashboard consistency", () => {
  it("monitoring/grafana-dashboard.json is valid JSON with schemaVersion 39 and prometheus UID", () => {
    expect(existsSync(dashboardPath)).toBe(true);
    const dashboard = JSON.parse(readFileSync(dashboardPath, "utf8"));
    expect(dashboard.schemaVersion).toBe(39);
    expect(dashboard.title).toBe("OphirPay — Payment Infrastructure");
  });

  it("monitoring/prometheus-alerts.yml references docs/OBSERVABILITY.md", () => {
    const alerts = existsSync(alertsPath) ? readFileSync(alertsPath, "utf8") : "";
    expect(alerts).toMatch(/docs\/OBSERVABILITY\.md/);
  });

  it("docs/metrics-endpoints.md references OBSERVABILITY.md", () => {
    const metricsDoc = existsSync(metricsEndpointsDocPath)
      ? readFileSync(metricsEndpointsDocPath, "utf8")
      : "";
    expect(metricsDoc).toMatch(/OBSERVABILITY\.md/);
  });

  it("README.md references docs/OBSERVABILITY.md", () => {
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    expect(readme).toMatch(/docs\/OBSERVABILITY\.md/);
  });
});
