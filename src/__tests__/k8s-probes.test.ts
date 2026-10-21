// SPDX-License-Identifier: MIT

/**
 * Issue #1426 — Kubernetes readiness and liveness probe initial delay and timeout tuning.
 *
 * Validates that both Helm values (`helm/ophirpay/values.yaml`) and raw Kubernetes
 * manifests (`k8s/deployment.yaml`) configure tuned probe parameters to prevent
 * cold-start CrashLoopBackOff while maintaining fast failure detection within 45s.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, loadAll } from "js-yaml";

const repoRoot = process.cwd();

interface ProbeSpec {
  httpGet: {
    path: string;
    port: number;
  };
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
}

interface HelmValues {
  livenessProbe: ProbeSpec;
  readinessProbe: ProbeSpec;
}

interface K8sDeployment {
  kind?: string;
  metadata?: { name?: string };
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          livenessProbe?: ProbeSpec;
          readinessProbe?: ProbeSpec;
        }>;
      };
    };
  };
}

describe("Kubernetes probe tuning (issue #1426)", () => {
  const helmValues = load(
    readFileSync(join(repoRoot, "helm", "ophirpay", "values.yaml"), "utf8"),
  ) as HelmValues;

  const rawK8s = readFileSync(join(repoRoot, "k8s", "deployment.yaml"), "utf8");
  const k8sDocs = loadAll(rawK8s) as K8sDeployment[];
  const deployment = k8sDocs.find((doc) => doc?.kind === "Deployment");
  const container = deployment?.spec?.template?.spec?.containers?.[0];

  describe("Helm chart values probe tuning", () => {
    it("configures liveness probe to /api/health/live with tuned parameters", () => {
      const { livenessProbe } = helmValues;
      expect(livenessProbe).toBeDefined();
      expect(livenessProbe.httpGet.path).toBe("/api/health/live");
      expect(livenessProbe.httpGet.port).toBe(3000);
      expect(livenessProbe.initialDelaySeconds).toBe(30);
      expect(livenessProbe.periodSeconds).toBe(10);
      expect(livenessProbe.timeoutSeconds).toBe(5);
      expect(livenessProbe.failureThreshold).toBe(3);
    });

    it("configures readiness probe to /api/health/ready with tuned parameters", () => {
      const { readinessProbe } = helmValues;
      expect(readinessProbe).toBeDefined();
      expect(readinessProbe.httpGet.path).toBe("/api/health/ready");
      expect(readinessProbe.httpGet.port).toBe(3000);
      expect(readinessProbe.initialDelaySeconds).toBe(15);
      expect(readinessProbe.periodSeconds).toBe(10);
      expect(readinessProbe.timeoutSeconds).toBe(5);
      expect(readinessProbe.failureThreshold).toBe(3);
    });
  });

  describe("k8s/deployment.yaml manifest synchronization", () => {
    it("defines container with matching liveness probe settings", () => {
      expect(container).toBeDefined();
      const liveness = container?.livenessProbe;
      expect(liveness).toBeDefined();
      expect(liveness?.httpGet?.path).toBe("/api/health/live");
      expect(liveness?.initialDelaySeconds).toBe(30);
      expect(liveness?.periodSeconds).toBe(10);
      expect(liveness?.timeoutSeconds).toBe(5);
      expect(liveness?.failureThreshold).toBe(3);
    });

    it("defines container with matching readiness probe settings", () => {
      expect(container).toBeDefined();
      const readiness = container?.readinessProbe;
      expect(readiness).toBeDefined();
      expect(readiness?.httpGet?.path).toBe("/api/health/ready");
      expect(readiness?.initialDelaySeconds).toBe(15);
      expect(readiness?.periodSeconds).toBe(10);
      expect(readiness?.timeoutSeconds).toBe(5);
      expect(readiness?.failureThreshold).toBe(3);
    });
  });

  describe("Probe SLA and failure detection guarantees", () => {
    it("guarantees failure detection window within 45s of failure", () => {
      // After running, failures occur when failureThreshold consecutive probes fail.
      // Maximum time from first probe failure to restart is:
      // (failureThreshold - 1) * periodSeconds + timeoutSeconds
      // For failureThreshold=3, period=10s, timeout=5s:
      // 2 * 10s + 5s = 25s, well within the 45s requirement.
      const threshold = helmValues.livenessProbe.failureThreshold;
      const period = helmValues.livenessProbe.periodSeconds;
      const timeout = helmValues.livenessProbe.timeoutSeconds;
      const maxFailureDetectionWindow = (threshold - 1) * period + timeout;

      expect(maxFailureDetectionWindow).toBeLessThanOrEqual(45);
    });
  });
});
