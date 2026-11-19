// SPDX-License-Identifier: MIT
/**
 * Tests for Kubernetes restricted Pod Security Standard (issue #1346).
 *
 * Acceptance Criteria:
 * - Pods admit in a namespace enforcing the restricted PSS
 * - App serves requests and ISR/image cache still works with a read-only root (emptyDir mounts)
 * - k8s/deployment.yaml mirrors the change
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load, loadAll } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Helm Pod Security Standard restricted profile (issue #1346)", () => {
  it("values.yaml specifies seccompProfile: RuntimeDefault and readOnlyRootFilesystem: true", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      podSecurityContext: {
        seccompProfile?: { type: string };
      };
      securityContext: {
        readOnlyRootFilesystem?: boolean;
        allowPrivilegeEscalation?: boolean;
        runAsNonRoot?: boolean;
        capabilities?: { drop?: string[] };
      };
    };

    expect(values.podSecurityContext.seccompProfile?.type).toBe("RuntimeDefault");
    expect(values.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(values.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(values.securityContext.runAsNonRoot).toBe(true);
    expect(values.securityContext.capabilities?.drop).toContain("ALL");
  });

  it("templates deployment.yaml with writable emptyDir mounts for .next/cache and /tmp", () => {
    const template = read("helm/ophirpay/templates/deployment.yaml");

    expect(template).toContain("mountPath: /app/.next/cache");
    expect(template).toContain("mountPath: /tmp");
    expect(template).toContain("name: next-cache");
    expect(template).toContain("name: tmp");
    expect(template).toContain("emptyDir: {}");
  });
});

describe("k8s/deployment.yaml restricted profile alignment (issue #1346)", () => {
  it("mirrors restricted PSS security contexts and emptyDir volume mounts", () => {
    const docs = loadAll(read("k8s/deployment.yaml")) as Array<{
      kind?: string;
      spec?: {
        template?: {
          spec?: {
            securityContext?: { seccompProfile?: { type: string } };
            volumes?: Array<{ name: string; emptyDir?: Record<string, unknown> }>;
            containers?: Array<{
              securityContext?: {
                readOnlyRootFilesystem?: boolean;
                allowPrivilegeEscalation?: boolean;
                runAsNonRoot?: boolean;
                capabilities?: { drop?: string[] };
              };
              volumeMounts?: Array<{ name: string; mountPath: string }>;
            }>;
          };
        };
      };
    }>;

    const deployment = docs.find((d) => d.kind === "Deployment");
    expect(deployment).toBeDefined();

    const podSpec = deployment!.spec!.template!.spec!;
    expect(podSpec.securityContext?.seccompProfile?.type).toBe("RuntimeDefault");

    const container = podSpec.containers![0];
    expect(container.securityContext?.readOnlyRootFilesystem).toBe(true);
    expect(container.securityContext?.allowPrivilegeEscalation).toBe(false);
    expect(container.securityContext?.runAsNonRoot).toBe(true);
    expect(container.securityContext?.capabilities?.drop).toContain("ALL");

    const mountPaths = container.volumeMounts?.map((vm) => vm.mountPath);
    expect(mountPaths).toContain("/app/.next/cache");
    expect(mountPaths).toContain("/tmp");

    const volumeNames = podSpec.volumes?.map((v) => v.name);
    expect(volumeNames).toContain("next-cache");
    expect(volumeNames).toContain("tmp");
  });
});
