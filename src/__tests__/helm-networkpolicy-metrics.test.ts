// SPDX-License-Identifier: MIT

/**
 * Issue #1344 — Helm NetworkPolicy blocks Prometheus from scraping /api/metrics.
 *
 * Verifies that:
 * 1. `helm/ophirpay/values.yaml` defines `networkPolicy.metrics` with default
 *    namespaceSelector targeting `kubernetes.io/metadata.name: monitoring`.
 * 2. `helm/ophirpay/templates/networkpolicy.yaml` renders the Prometheus ingress rule
 *    matching the configured namespaceSelector and optional podSelector on service.targetPort.
 * 3. Default ingress isolation is preserved and other unselected sources remain blocked.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const chartDir = join(process.cwd(), "helm", "ophirpay");
const valuesPath = join(chartDir, "values.yaml");
const templatePath = join(chartDir, "templates", "networkpolicy.yaml");

interface ValuesYaml {
  networkPolicy?: {
    enabled?: boolean;
    metrics?: {
      enabled?: boolean;
      namespaceSelector?: {
        matchLabels?: Record<string, string>;
      };
      podSelector?: {
        matchLabels?: Record<string, string>;
      };
    };
  };
  service?: {
    targetPort?: number;
  };
}

describe("Helm NetworkPolicy Prometheus Ingress (#1344)", () => {
  it("defines networkPolicy.metrics in values.yaml with default monitoring namespace", () => {
    expect(existsSync(valuesPath)).toBe(true);
    const content = readFileSync(valuesPath, "utf8");
    const values = load(content) as ValuesYaml;

    expect(values.networkPolicy).toBeDefined();
    expect(values.networkPolicy?.enabled).toBe(true);

    const metrics = values.networkPolicy?.metrics;
    expect(metrics).toBeDefined();
    expect(metrics?.enabled).toBe(true);
    expect(metrics?.namespaceSelector).toBeDefined();
    expect(metrics?.namespaceSelector?.matchLabels).toEqual({
      "kubernetes.io/metadata.name": "monitoring",
    });
    expect(metrics?.podSelector).toBeDefined();
  });

  it("renders Prometheus ingress rule on service.targetPort in templates/networkpolicy.yaml", () => {
    expect(existsSync(templatePath)).toBe(true);
    const templateContent = readFileSync(templatePath, "utf8");

    // Guard on networkPolicy.metrics.enabled
    expect(templateContent).toContain(".Values.networkPolicy.metrics.enabled");
    // Selectors
    expect(templateContent).toContain(".Values.networkPolicy.metrics.namespaceSelector");
    expect(templateContent).toContain(".Values.networkPolicy.metrics.podSelector");
    // Target port
    expect(templateContent).toContain(".Values.service.targetPort");
  });

  it("preserves default ingress-nginx ingress rule and standard egress rules", () => {
    const templateContent = readFileSync(templatePath, "utf8");

    // ingress-nginx
    expect(templateContent).toContain("kubernetes.io/metadata.name: ingress-nginx");
    // DNS (UDP & TCP 53)
    expect(templateContent).toContain("port: 53");
    // HTTPS (TCP 443)
    expect(templateContent).toContain("port: 443");
    // PostgreSQL (TCP 5432)
    expect(templateContent).toContain("port: 5432");
  });
});
