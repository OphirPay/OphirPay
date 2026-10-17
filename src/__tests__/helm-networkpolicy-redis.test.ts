// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1345 — Helm NetworkPolicy blocks Redis egress, breaking shared rate limiting.
 *
 * Verifies:
 *   • `helm/ophirpay/values.yaml` documents and configures `networkPolicy.redis`
 *     (`enabled: true`, `port: 6379`, `podSelector: { app: "redis" }`,
 *     `namespaceSelector: {}`) and `networkPolicy.egress.extraPorts`.
 *   • `helm/ophirpay/templates/networkpolicy.yaml` renders a selector-scoped
 *     (`to:` `podSelector`/`namespaceSelector`) TCP Redis egress rule on the
 *     configured port, plus any `networkPolicy.egress.extraPorts` entries,
 *     keeping egress restricted to explicitly listed destinations.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Helm NetworkPolicy Redis egress (issue #1345)", () => {
  it("configures and documents networkPolicy.redis and networkPolicy.egress.extraPorts in values.yaml", () => {
    const rawValues = read("helm/ophirpay/values.yaml");
    expect(rawValues).toMatch(/Redis egress/i);
    expect(rawValues).toContain("6379");

    const values = load(rawValues) as {
      networkPolicy: {
        enabled: boolean;
        redis: {
          enabled: boolean;
          port: number;
          namespaceSelector: Record<string, string>;
          podSelector: Record<string, string>;
        };
        egress: {
          extraPorts: unknown[];
        };
      };
    };

    expect(values.networkPolicy.enabled).toBe(true);
    expect(values.networkPolicy.redis).toEqual({
      enabled: true,
      port: 6379,
      namespaceSelector: {},
      podSelector: { app: "redis" },
    });
    expect(values.networkPolicy.egress.extraPorts).toEqual([]);
  });

  it("renders selector-scoped Redis TCP egress and extraPorts in templates/networkpolicy.yaml", () => {
    const template = read("helm/ophirpay/templates/networkpolicy.yaml");

    expect(template).toContain(".Values.networkPolicy.redis.enabled");
    expect(template).toContain(".Values.networkPolicy.redis.podSelector");
    expect(template).toContain(".Values.networkPolicy.redis.namespaceSelector");
    expect(template).toContain(".Values.networkPolicy.redis.port | default 6379");
    expect(template).toContain(".Values.networkPolicy.egress.extraPorts");
    // Ensure egress stays restricted to explicit `to:` selectors for Redis
    expect(template).toMatch(
      /-\s+to:\s*\n\s*-\s*\{\{-?\s*if\s+\.Values\.networkPolicy\.redis\.namespaceSelector/
    );
  });
});
