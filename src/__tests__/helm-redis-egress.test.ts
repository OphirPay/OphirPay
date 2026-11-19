// SPDX-License-Identifier: MIT
/**
 * Tests for Redis NetworkPolicy egress (issue #1345).
 *
 * Acceptance Criteria:
 * - With the policy enabled, pods can reach a TCP Redis on the configured port
 * - Egress remains restricted to explicitly listed destinations
 * - Values are documented
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Helm NetworkPolicy Redis egress (issue #1345)", () => {
  it("defines Redis egress configuration and extraPorts in values.yaml", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      networkPolicy: {
        enabled: boolean;
        redis: {
          enabled: boolean;
          port: number;
          namespaceSelector?: Record<string, unknown>;
          podSelector?: Record<string, unknown>;
        };
        egress: {
          extraPorts?: number[];
        };
      };
    };

    expect(values.networkPolicy.enabled).toBe(true);
    expect(values.networkPolicy.redis.enabled).toBe(true);
    expect(values.networkPolicy.redis.port).toBe(6379);
    expect(Array.isArray(values.networkPolicy.egress.extraPorts)).toBe(true);
  });

  it("templates networkpolicy.yaml with Redis egress rule and extraPorts", () => {
    const template = read("helm/ophirpay/templates/networkpolicy.yaml");

    expect(template).toContain(".Values.networkPolicy.redis.enabled");
    expect(template).toContain(".Values.networkPolicy.redis.port");
    expect(template).toContain(".Values.networkPolicy.egress.extraPorts");
  });
});
