// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { load, loadAll } from "js-yaml";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

interface ProbeConfig {
  httpGet: { path: string; port: number };
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
}

describe("Kubernetes readiness and liveness probe timing tuning (#1426)", () => {
  it("tunes readinessProbe (initialDelaySeconds=15) and livenessProbe (initialDelaySeconds=30) in helm/ophirpay/values.yaml", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      livenessProbe: ProbeConfig;
      readinessProbe: ProbeConfig;
    };

    expect(values.readinessProbe).toEqual({
      httpGet: { path: "/api/health", port: 3000 },
      initialDelaySeconds: 15,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    });

    expect(values.livenessProbe).toEqual({
      httpGet: { path: "/api/health/live", port: 3000 },
      initialDelaySeconds: 30,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    });
  });

  it("keeps k8s/deployment.yaml probe timings in sync with helm/ophirpay/values.yaml", () => {
    const docs = loadAll(read("k8s/deployment.yaml")) as Array<
      Record<string, unknown>
    >;
    const deployment = docs.find((d) => d.kind === "Deployment") as {
      spec: {
        template: {
          spec: {
            containers: Array<{
              livenessProbe: ProbeConfig;
              readinessProbe: ProbeConfig;
            }>;
          };
        };
      };
    };

    const container = deployment.spec.template.spec.containers[0];
    expect(container.readinessProbe).toEqual({
      httpGet: { path: "/api/health", port: 3000 },
      initialDelaySeconds: 15,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    });

    expect(container.livenessProbe).toEqual({
      httpGet: { path: "/api/health/live", port: 3000 },
      initialDelaySeconds: 30,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    });
  });

  it("documents probe tuning in docs/KUBERNETES.md and helm/ophirpay/templates/deployment.yaml", () => {
    const k8sDoc = read("docs/KUBERNETES.md");
    expect(k8sDoc).toContain("readinessProbe");
    expect(k8sDoc).toContain("livenessProbe");
    expect(k8sDoc).toContain("/api/health/live");
    expect(k8sDoc).toContain("15");
    expect(k8sDoc).toContain("30");

    const helmDeployment = read("helm/ophirpay/templates/deployment.yaml");
    expect(helmDeployment).toContain(".Values.livenessProbe");
    expect(helmDeployment).toContain(".Values.readinessProbe");
  });
});
