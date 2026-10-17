// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1344 — Helm NetworkPolicy blocks Prometheus from scraping /api/metrics.
 *
 * Verifies:
 *   • `helm/ophirpay/values.yaml` documents and configures `networkPolicy.metrics`
 *     (`enabled: true`, `namespaceSelector: { "kubernetes.io/metadata.name": "monitoring" }`,
 *     `podSelector: {}`).
 *   • `helm/ophirpay/templates/networkpolicy.yaml` renders an extra ingress
 *     rule for `{{ .Values.service.targetPort }}` scoped to the configured
 *     `networkPolicy.metrics.namespaceSelector` / `podSelector`, while keeping
 *     other namespaces blocked.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Helm NetworkPolicy Prometheus metrics ingress (issue #1344)", () => {
  it("configures and documents networkPolicy.metrics selector in values.yaml", () => {
    const rawValues = read("helm/ophirpay/values.yaml");
    expect(rawValues).toMatch(/Prometheus metrics ingress/i);
    expect(rawValues).toContain("kubernetes.io/metadata.name: monitoring");

    const values = load(rawValues) as {
      networkPolicy: {
        enabled: boolean;
        metrics: {
          enabled: boolean;
          namespaceSelector: Record<string, string>;
          podSelector: Record<string, string>;
        };
      };
    };

    expect(values.networkPolicy.enabled).toBe(true);
    expect(values.networkPolicy.metrics).toEqual({
      enabled: true,
      namespaceSelector: {
        "kubernetes.io/metadata.name": "monitoring",
      },
      podSelector: {},
    });
  });

  it("renders a selector-scoped ingress rule for service.targetPort in templates/networkpolicy.yaml", () => {
    const template = read("helm/ophirpay/templates/networkpolicy.yaml");

    expect(template).toContain(".Values.networkPolicy.metrics.enabled");
    expect(template).toContain(".Values.networkPolicy.metrics.namespaceSelector");
    expect(template).toContain(".Values.networkPolicy.metrics.podSelector");

    // Both ingress-nginx and the metrics rule must target {{ .Values.service.targetPort }}
    const targetPortMatches = template.match(/port:\s*\{\{\s*\.Values\.service\.targetPort\s*\}\}/g);
    expect(targetPortMatches?.length).toBe(2);

    // Ensure the ingress rule is scoped with `from:` so other namespaces remain blocked
    expect(template).toMatch(
      /-\s+from:\s*\n\s*-\s*\{\{-?\s*if\s+\.Values\.networkPolicy\.metrics\.namespaceSelector/
    );
  });
});
