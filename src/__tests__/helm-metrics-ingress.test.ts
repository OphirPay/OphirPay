// SPDX-License-Identifier: MIT
/**
 * Tests for Prometheus metrics scraping NetworkPolicy ingress (issue #1344).
 *
 * Acceptance Criteria:
 * - Prometheus in the configured namespace can scrape pods with the policy enabled
 * - Other namespaces remain blocked
 * - Selector is configurable and documented
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Helm NetworkPolicy Prometheus metrics ingress (issue #1344)", () => {
  it("defines metrics scraping ingress configuration in values.yaml", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      networkPolicy: {
        enabled: boolean;
        metrics: {
          enabled: boolean;
          namespaceSelector: { matchLabels: Record<string, string> };
        };
      };
    };

    expect(values.networkPolicy.enabled).toBe(true);
    expect(values.networkPolicy.metrics.enabled).toBe(true);
    expect(
      values.networkPolicy.metrics.namespaceSelector.matchLabels[
        "kubernetes.io/metadata.name"
      ]
    ).toBe("monitoring");
  });

  it("templates networkpolicy.yaml with metrics scraping ingress rule", () => {
    const template = read("helm/ophirpay/templates/networkpolicy.yaml");

    expect(template).toContain(".Values.networkPolicy.metrics.enabled");
    expect(template).toContain(".Values.networkPolicy.metrics.namespaceSelector");
    expect(template).toContain(".Values.service.targetPort");
  });
});
