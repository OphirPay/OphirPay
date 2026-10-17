// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1346 — Helm pod security context does not meet the Kubernetes
 * restricted Pod Security Standard.
 *
 * Verifies:
 *   • `helm/ophirpay/values.yaml` configures `podSecurityContext.seccompProfile.type: RuntimeDefault`
 *     and `securityContext.readOnlyRootFilesystem: true` alongside `runAsNonRoot: true`,
 *     `allowPrivilegeEscalation: false`, and `capabilities.drop: ["ALL"]`.
 *   • `helm/ophirpay/templates/deployment.yaml` mounts writable `emptyDir`
 *     volumes at `/app/.next/cache` and `/tmp` so Next.js ISR/image caching
 *     works on a read-only root filesystem.
 *   • `k8s/deployment.yaml` mirrors all restricted Pod Security Standard
 *     fields and `emptyDir` volume mounts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load, loadAll } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Kubernetes restricted Pod Security Standard (issue #1346)", () => {
  it("helm/ophirpay/values.yaml satisfies the restricted Pod Security Standard", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      podSecurityContext: {
        fsGroup: number;
        seccompProfile: { type: string };
      };
      securityContext: {
        allowPrivilegeEscalation: boolean;
        readOnlyRootFilesystem: boolean;
        runAsNonRoot: boolean;
        runAsUser: number;
        capabilities: { drop: string[] };
      };
    };

    expect(values.podSecurityContext.seccompProfile).toEqual({
      type: "RuntimeDefault",
    });
    expect(values.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(values.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(values.securityContext.runAsNonRoot).toBe(true);
    expect(values.securityContext.capabilities.drop).toContain("ALL");
  });

  it("helm/ophirpay/templates/deployment.yaml mounts emptyDir volumes at /app/.next/cache and /tmp", () => {
    const template = read("helm/ophirpay/templates/deployment.yaml");

    expect(template).toContain("mountPath: /app/.next/cache");
    expect(template).toContain("mountPath: /tmp");
    expect(template).toContain("name: next-cache");
    expect(template).toContain("name: tmp");
    expect(template).toMatch(/volumes:\s*\n\s*-\s*name:\s*next-cache\s*\n\s*emptyDir:\s*\{\}/);
    expect(template).toMatch(/-\s*name:\s*tmp\s*\n\s*emptyDir:\s*\{\}/);
  });

  it("k8s/deployment.yaml mirrors restricted PSS settings and emptyDir mounts", () => {
    const docs = loadAll(read("k8s/deployment.yaml")) as Array<Record<string, unknown>>;
    const deployment = docs.find((d) => d.kind === "Deployment") as {
      spec: {
        template: {
          spec: {
            securityContext: {
              fsGroup: number;
              seccompProfile: { type: string };
            };
            volumes: Array<{ name: string; emptyDir?: Record<string, unknown> }>;
            containers: Array<{
              securityContext: {
                allowPrivilegeEscalation: boolean;
                readOnlyRootFilesystem: boolean;
                runAsNonRoot: boolean;
                runAsUser: number;
                capabilities: { drop: string[] };
              };
              volumeMounts: Array<{ name: string; mountPath: string }>;
            }>;
          };
        };
      };
    };

    expect(deployment).toBeDefined();
    const podSpec = deployment.spec.template.spec;
    expect(podSpec.securityContext.seccompProfile).toEqual({
      type: "RuntimeDefault",
    });

    const container = podSpec.containers[0]!;
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(container.securityContext.runAsNonRoot).toBe(true);
    expect(container.securityContext.capabilities.drop).toContain("ALL");

    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "next-cache", mountPath: "/app/.next/cache" },
        { name: "tmp", mountPath: "/tmp" },
      ])
    );
    expect(podSpec.volumes).toEqual(
      expect.arrayContaining([
        { name: "next-cache", emptyDir: {} },
        { name: "tmp", emptyDir: {} },
      ])
    );
  });
});
