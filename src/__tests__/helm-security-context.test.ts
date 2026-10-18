// SPDX-License-Identifier: MIT

/**
 * Issue #1346 — Helm pod security context does not meet the Kubernetes restricted Pod Security Standard.
 *
 * Verifies that:
 * 1. `helm/ophirpay/values.yaml` defines `seccompProfile: { type: RuntimeDefault }` at pod level
 *    and `readOnlyRootFilesystem: true` at container level.
 * 2. Writable `emptyDir` mounts are configured at `/app/.next/cache` and `/tmp`.
 * 3. `helm/ophirpay/templates/deployment.yaml` renders `volumeMounts` and `volumes`.
 * 4. `k8s/deployment.yaml` strictly mirrors the restricted security configuration.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load, loadAll } from "js-yaml";

const repoRoot = process.cwd();
const chartDir = join(repoRoot, "helm", "ophirpay");
const valuesPath = join(chartDir, "values.yaml");
const templatePath = join(chartDir, "templates", "deployment.yaml");
const k8sDeploymentPath = join(repoRoot, "k8s", "deployment.yaml");

interface ValuesYaml {
  podSecurityContext?: {
    fsGroup?: number;
    seccompProfile?: {
      type?: string;
    };
  };
  securityContext?: {
    allowPrivilegeEscalation?: boolean;
    readOnlyRootFilesystem?: boolean;
    runAsNonRoot?: boolean;
    runAsUser?: number;
    capabilities?: {
      drop?: string[];
    };
  };
  volumeMounts?: Array<{
    name: string;
    mountPath: string;
  }>;
  volumes?: Array<{
    name: string;
    emptyDir?: Record<string, unknown>;
  }>;
}

interface K8sDeployment {
  apiVersion: string;
  kind: string;
  metadata?: {
    name?: string;
  };
  spec?: {
    template?: {
      spec?: {
        securityContext?: {
          fsGroup?: number;
          seccompProfile?: {
            type?: string;
          };
        };
        containers?: Array<{
          name?: string;
          securityContext?: {
            allowPrivilegeEscalation?: boolean;
            readOnlyRootFilesystem?: boolean;
            runAsNonRoot?: boolean;
            runAsUser?: number;
            capabilities?: {
              drop?: string[];
            };
          };
          volumeMounts?: Array<{
            name: string;
            mountPath: string;
          }>;
        }>;
        volumes?: Array<{
          name: string;
          emptyDir?: Record<string, unknown>;
        }>;
      };
    };
  };
}

describe("Helm Pod Security Standard Restricted (#1346)", () => {
  it("defines restricted pod and container securityContext in values.yaml", () => {
    expect(existsSync(valuesPath)).toBe(true);
    const content = readFileSync(valuesPath, "utf8");
    const values = load(content) as ValuesYaml;

    // Pod-level seccomp profile
    expect(values.podSecurityContext).toBeDefined();
    expect(values.podSecurityContext?.fsGroup).toBe(1001);
    expect(values.podSecurityContext?.seccompProfile).toEqual({
      type: "RuntimeDefault",
    });

    // Container-level restricted securityContext
    expect(values.securityContext).toBeDefined();
    expect(values.securityContext?.allowPrivilegeEscalation).toBe(false);
    expect(values.securityContext?.readOnlyRootFilesystem).toBe(true);
    expect(values.securityContext?.runAsNonRoot).toBe(true);
    expect(values.securityContext?.runAsUser).toBe(1001);
    expect(values.securityContext?.capabilities?.drop).toEqual(["ALL"]);

    // Next.js cache and tmp emptyDir mounts for read-only root filesystem
    expect(values.volumeMounts).toBeDefined();
    expect(values.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "next-cache", mountPath: "/app/.next/cache" },
        { name: "tmp", mountPath: "/tmp" },
      ]),
    );

    expect(values.volumes).toBeDefined();
    expect(values.volumes).toEqual(
      expect.arrayContaining([
        { name: "next-cache", emptyDir: {} },
        { name: "tmp", emptyDir: {} },
      ]),
    );
  });

  it("renders volumeMounts and volumes in templates/deployment.yaml", () => {
    expect(existsSync(templatePath)).toBe(true);
    const templateContent = readFileSync(templatePath, "utf8");

    expect(templateContent).toContain(".Values.podSecurityContext");
    expect(templateContent).toContain(".Values.securityContext");
    expect(templateContent).toContain(".Values.volumeMounts");
    expect(templateContent).toContain(".Values.volumes");
  });

  it("mirrors the restricted security context and emptyDir mounts in k8s/deployment.yaml", () => {
    expect(existsSync(k8sDeploymentPath)).toBe(true);
    const docs = loadAll(readFileSync(k8sDeploymentPath, "utf8")) as K8sDeployment[];
    const deployment = docs.find((d) => d.kind === "Deployment");

    expect(deployment).toBeDefined();
    const podSpec = deployment?.spec?.template?.spec;
    expect(podSpec).toBeDefined();

    // Pod security context
    expect(podSpec?.securityContext?.fsGroup).toBe(1001);
    expect(podSpec?.securityContext?.seccompProfile).toEqual({
      type: "RuntimeDefault",
    });

    // Container security context
    const container = podSpec?.containers?.[0];
    expect(container).toBeDefined();
    expect(container?.securityContext?.allowPrivilegeEscalation).toBe(false);
    expect(container?.securityContext?.readOnlyRootFilesystem).toBe(true);
    expect(container?.securityContext?.runAsNonRoot).toBe(true);
    expect(container?.securityContext?.runAsUser).toBe(1001);
    expect(container?.securityContext?.capabilities?.drop).toEqual(["ALL"]);

    // Volumes & Volume mounts
    expect(container?.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "next-cache", mountPath: "/app/.next/cache" },
        { name: "tmp", mountPath: "/tmp" },
      ]),
    );

    expect(podSpec?.volumes).toEqual(
      expect.arrayContaining([
        { name: "next-cache", emptyDir: {} },
        { name: "tmp", emptyDir: {} },
      ]),
    );
  });
});
