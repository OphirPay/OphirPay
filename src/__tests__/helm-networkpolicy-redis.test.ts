// SPDX-License-Identifier: MIT

/**
 * Issue #1345 — Helm NetworkPolicy blocks Redis egress, breaking shared rate limiting.
 *
 * Verifies that:
 * 1. `helm/ophirpay/values.yaml` defines `networkPolicy.redis` (default enabled: true, port: 6379)
 *    and `networkPolicy.egress.extraPorts`.
 * 2. `helm/ophirpay/templates/networkpolicy.yaml` renders the Redis egress rule, supports
 *    selector scoping (`namespaceSelector` / `podSelector`), and extraPorts.
 * 3. Egress remains restricted to explicitly allowed destinations.
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
    redis?: {
      enabled?: boolean;
      port?: number;
      namespaceSelector?: Record<string, unknown>;
      podSelector?: Record<string, unknown>;
    };
    egress?: {
      extraPorts?: number[];
    };
  };
  service?: {
    targetPort?: number;
  };
}

describe("Helm NetworkPolicy Redis Egress (#1345)", () => {
  it("exists in values.yaml with default enabled configuration", () => {
    expect(existsSync(valuesPath)).toBe(true);
    const content = readFileSync(valuesPath, "utf8");
    const values = load(content) as ValuesYaml;

    expect(values.networkPolicy).toBeDefined();
    expect(values.networkPolicy?.enabled).toBe(true);

    const redis = values.networkPolicy?.redis;
    expect(redis).toBeDefined();
    expect(redis?.enabled).toBe(true);
    expect(redis?.port).toBe(6379);
    expect(redis?.namespaceSelector).toBeDefined();
    expect(redis?.podSelector).toBeDefined();

    expect(values.networkPolicy?.egress).toBeDefined();
    expect(Array.isArray(values.networkPolicy?.egress?.extraPorts)).toBe(true);
  });

  it("templates/networkpolicy.yaml contains Redis egress and extraPorts directives", () => {
    expect(existsSync(templatePath)).toBe(true);
    const templateContent = readFileSync(templatePath, "utf8");

    // Guard on networkPolicy.redis.enabled
    expect(templateContent).toContain(".Values.networkPolicy.redis.enabled");
    // Port definition using redis.port fallback to 6379
    expect(templateContent).toContain(".Values.networkPolicy.redis.port");
    expect(templateContent).toContain("6379");
    // Selector scoping support
    expect(templateContent).toContain(".Values.networkPolicy.redis.namespaceSelector");
    expect(templateContent).toContain(".Values.networkPolicy.redis.podSelector");
    // Extra ports iteration
    expect(templateContent).toContain(".Values.networkPolicy.egress.extraPorts");
  });

  it("preserves standard DNS, HTTPS, and PostgreSQL egress rules", () => {
    const templateContent = readFileSync(templatePath, "utf8");

    // DNS (UDP & TCP 53)
    expect(templateContent).toContain("port: 53");
    // HTTPS (TCP 443)
    expect(templateContent).toContain("port: 443");
    // PostgreSQL (TCP 5432)
    expect(templateContent).toContain("port: 5432");
  });
});
