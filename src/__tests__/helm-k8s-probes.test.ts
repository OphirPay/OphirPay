// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, loadAll } from "js-yaml";

interface ProbeConfig {
  httpGet?: {
    path: string;
    port: number;
  };
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
}

interface HelmValues {
  livenessProbe: ProbeConfig;
  readinessProbe: ProbeConfig;
}

interface K8sDeployment {
  apiVersion: string;
  kind: string;
  metadata?: { name?: string };
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{
          name: string;
          livenessProbe?: ProbeConfig;
          readinessProbe?: ProbeConfig;
        }>;
      };
    };
  };
}

describe("Kubernetes and Helm Probe Timing and Threshold Tuning (#1426)", () => {
  const chartValuesPath = join(process.cwd(), "helm", "ophirpay", "values.yaml");
  const k8sDeploymentPath = join(process.cwd(), "k8s", "deployment.yaml");

  const values = load(readFileSync(chartValuesPath, "utf8")) as HelmValues;
  const k8sDocs = loadAll(readFileSync(k8sDeploymentPath, "utf8")) as K8sDeployment[];
  const deployment = k8sDocs.find((doc) => doc?.kind === "Deployment" && doc?.metadata?.name === "ophirpay");

  it("loads Helm values and Kubernetes deployment manifest", () => {
    expect(values).toBeDefined();
    expect(deployment).toBeDefined();
    expect(deployment?.spec?.template?.spec?.containers).toBeDefined();
  });

  describe("Helm values.yaml probe configuration", () => {
    it("configures liveness probe correctly", () => {
      const probe = values.livenessProbe;
      expect(probe.httpGet?.path).toBe("/api/health/live");
      expect(probe.httpGet?.port).toBe(3000);
      expect(probe.initialDelaySeconds).toBe(30);
      expect(probe.periodSeconds).toBe(10);
      expect(probe.timeoutSeconds).toBe(5);
      expect(probe.failureThreshold).toBe(3);
    });

    it("configures readiness probe correctly", () => {
      const probe = values.readinessProbe;
      expect(probe.httpGet?.path).toBe("/api/health");
      expect(probe.httpGet?.port).toBe(3000);
      expect(probe.initialDelaySeconds).toBe(15);
      expect(probe.periodSeconds).toBe(10);
      expect(probe.timeoutSeconds).toBe(5);
      expect(probe.failureThreshold).toBe(3);
    });
  });

  describe("k8s/deployment.yaml parity with Helm values", () => {
    const ophirpayContainer = deployment?.spec?.template?.spec?.containers?.find(
      (c) => c.name === "ophirpay"
    );

    it("has the main ophirpay container", () => {
      expect(ophirpayContainer).toBeDefined();
    });

    it("matches livenessProbe between k8s manifest and Helm values", () => {
      const k8sProbe = ophirpayContainer?.livenessProbe;
      expect(k8sProbe).toBeDefined();
      expect(k8sProbe?.httpGet?.path).toBe(values.livenessProbe.httpGet?.path);
      expect(k8sProbe?.httpGet?.port).toBe(values.livenessProbe.httpGet?.port);
      expect(k8sProbe?.initialDelaySeconds).toBe(values.livenessProbe.initialDelaySeconds);
      expect(k8sProbe?.periodSeconds).toBe(values.livenessProbe.periodSeconds);
      expect(k8sProbe?.timeoutSeconds).toBe(values.livenessProbe.timeoutSeconds);
      expect(k8sProbe?.failureThreshold).toBe(values.livenessProbe.failureThreshold);
    });

    it("matches readinessProbe between k8s manifest and Helm values", () => {
      const k8sProbe = ophirpayContainer?.readinessProbe;
      expect(k8sProbe).toBeDefined();
      expect(k8sProbe?.httpGet?.path).toBe(values.readinessProbe.httpGet?.path);
      expect(k8sProbe?.httpGet?.port).toBe(values.readinessProbe.httpGet?.port);
      expect(k8sProbe?.initialDelaySeconds).toBe(values.readinessProbe.initialDelaySeconds);
      expect(k8sProbe?.periodSeconds).toBe(values.readinessProbe.periodSeconds);
      expect(k8sProbe?.timeoutSeconds).toBe(values.readinessProbe.timeoutSeconds);
      expect(k8sProbe?.failureThreshold).toBe(values.readinessProbe.failureThreshold);
    });
  });

  describe("Operational thresholds and SLA criteria", () => {
    it("ensures cold-start buffer allows at least 35s before readiness failure threshold", () => {
      const probe = values.readinessProbe;
      const initialGracePeriod = probe.initialDelaySeconds + (probe.failureThreshold - 1) * probe.periodSeconds;
      expect(initialGracePeriod).toBeGreaterThanOrEqual(35);
    });

    it("ensures unresponsive pods are detected and restarted within 45s of actual failure", () => {
      const probe = values.livenessProbe;
      const failureDetectionWindow = probe.periodSeconds * probe.failureThreshold;
      expect(failureDetectionWindow).toBeLessThanOrEqual(45);
    });
  });
});
