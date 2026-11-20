// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

interface HelmValues {
  readinessProbe: {
    httpGet: {
      path: string;
      port: number;
    };
    initialDelaySeconds: number;
    periodSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
  livenessProbe: {
    httpGet: {
      path: string;
      port: number;
    };
    initialDelaySeconds: number;
    periodSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
}

describe("Helm readiness probe configuration (#1984)", () => {
  const repoRoot = join(__dirname, "../..");
  const valuesPath = join(repoRoot, "helm/ophirpay/values.yaml");
  const schemaPath = join(repoRoot, "helm/ophirpay/values.schema.json");
  const deploymentPath = join(repoRoot, "helm/ophirpay/templates/deployment.yaml");

  const valuesContent = readFileSync(valuesPath, "utf8");
  const values = load(valuesContent) as HelmValues;
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const deploymentContent = readFileSync(deploymentPath, "utf8");

  it("configures readinessProbe in helm/ophirpay/values.yaml with sensible timings", () => {
    expect(values.readinessProbe).toBeDefined();
    expect(values.readinessProbe.httpGet).toBeDefined();
    expect(values.readinessProbe.httpGet.path).toMatch(/^\/api\/health/);
    expect(values.readinessProbe.httpGet.port).toBe(3000);
    expect(values.readinessProbe.initialDelaySeconds).toBe(15);
    expect(values.readinessProbe.periodSeconds).toBe(10);
    expect(values.readinessProbe.timeoutSeconds).toBe(5);
    expect(values.readinessProbe.failureThreshold).toBe(3);
  });

  it("enforces probe schema in values.schema.json", () => {
    expect(schema.properties.readinessProbe).toBeDefined();
    expect(schema.properties.readinessProbe.$ref).toBe("#/definitions/probeSpec");
    expect(schema.definitions.probeSpec).toBeDefined();
    expect(schema.definitions.probeSpec.properties.httpGet.required).toContain("path");
    expect(schema.definitions.probeSpec.properties.httpGet.required).toContain("port");
    expect(schema.definitions.probeSpec.properties.initialDelaySeconds.type).toBe("integer");
    expect(schema.definitions.probeSpec.properties.periodSeconds.type).toBe("integer");
  });

  it("conditionally renders readinessProbe in deployment template", () => {
    expect(deploymentContent).toContain("{{- if .Values.readinessProbe }}");
    expect(deploymentContent).toContain("readinessProbe:");
    expect(deploymentContent).toContain("{{- toYaml .Values.readinessProbe | nindent 12 }}");
  });
});
