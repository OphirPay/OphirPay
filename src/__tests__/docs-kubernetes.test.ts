// SPDX-License-Identifier: MIT
//
// Content tests for the Kubernetes & Helm deployment guide (issue #785).
// These guard the acceptance criteria: required values and secret provisioning
// are listed, the build-time NEXT_PUBLIC_* caveat is stated prominently, and a
// pre-flight checklist exists (helm lint / helm template --debug / kubeconform)
// — plus the config-key consistency fix (values.yaml, k8s/namespace-config.yaml)
// that motivated the guide.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "KUBERNETES.md");
const deploymentPath = path.join(root, "docs", "DEPLOYMENT.md");
const envPath = path.join(root, "src", "lib", "env.ts");
const valuesPath = path.join(root, "helm", "ophirpay", "values.yaml");
const deploymentTplPath = path.join(
  root,
  "helm",
  "ophirpay",
  "templates",
  "deployment.yaml"
);
const saTplPath = path.join(
  root,
  "helm",
  "ophirpay",
  "templates",
  "serviceaccount.yaml"
);
const k8sConfigPath = path.join(root, "k8s", "namespace-config.yaml");
const k8sDeploymentPath = path.join(root, "k8s", "deployment.yaml");

const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("docs/KUBERNETES.md (Kubernetes & Helm deployment guide)", () => {
  const doc = read(docPath);

  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  it("documents prerequisites and the starting-point status", () => {
    expect(doc).toMatch(/## 1\. Prerequisites/);
    expect(doc).toMatch(/starting point, not a supported product/i);
  });

  it("lists required values and secret provisioning", () => {
    expect(doc).toMatch(/## 3\. Required and optional values/);
    expect(doc).toContain("secrets.DATABASE_URL");
    expect(doc).toContain("secrets.AUTH_SECRET");
    expect(doc).toContain("secrets.NEXT_PUBLIC_CONTRACT_ID");
    expect(doc).toMatch(/## 4\. Provisioning secrets/);
    expect(doc).toContain("values.secrets.yaml");
  });

  it("states the build-time NEXT_PUBLIC_* caveat prominently", () => {
    expect(doc).toMatch(/## 5\. Build-time vs runtime configuration/);
    expect(doc).toMatch(
      /inlined into the JavaScript bundles at `next build` time/
    );
    expect(doc).toMatch(/no effect/i);
  });

  it("documents the migration step", () => {
    expect(doc).toMatch(/## 6\. Running database migrations/);
    expect(doc).toContain("npx prisma migrate deploy");
  });

  it("documents ingress/TLS and probe tuning against /api/health", () => {
    expect(doc).toMatch(/## 7\. Ingress and TLS/);
    expect(doc).toContain("cert-manager");
    expect(doc).toMatch(/## 8\. Probes and the health endpoint/);
    expect(doc).toContain("/api/health");
  });

  it("includes a pre-flight checklist with helm template --debug and kubeconform", () => {
    expect(doc).toMatch(/## 10\. Pre-flight checklist/);
    expect(doc).toContain("helm lint");
    expect(doc).toContain("helm template");
    expect(doc).toContain("--debug");
    expect(doc).toContain("kubeconform");
  });
});

describe("Kubernetes config keys match the env schema (src/lib/env.ts)", () => {
  it("the env schema declares the NEXT_PUBLIC_STELLAR_* names", () => {
    const env = read(envPath);
    expect(env).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(env).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
  });

  it("helm values use the schema keys, not the legacy names", () => {
    const values = read(valuesPath);
    expect(values).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(values).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
    expect(values).not.toMatch(/NEXT_PUBLIC_HORIZON_URL/);
    expect(values).not.toMatch(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
  });

  it("the plain k8s ConfigMap uses the same keys", () => {
    const k8s = read(k8sConfigPath);
    expect(k8s).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(k8s).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
    expect(k8s).not.toMatch(/NEXT_PUBLIC_HORIZON_URL/);
    expect(k8s).not.toMatch(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
  });

  it("DEPLOYMENT.md links the guide and no longer documents the legacy keys", () => {
    const deployment = read(deploymentPath);
    expect(deployment).toMatch(/KUBERNETES\.md/);
    expect(deployment).not.toMatch(/NEXT_PUBLIC_HORIZON_URL/);
    expect(deployment).not.toMatch(/NEXT_PUBLIC_SOROBAN_RPC_URL/);
  });
});

describe("helm chart renders the ServiceAccount it references", () => {
  it("ships a serviceaccount template guarded by serviceAccount.create", () => {
    expect(existsSync(saTplPath)).toBe(true);
    const tpl = read(saTplPath);
    expect(tpl).toContain("kind: ServiceAccount");
    expect(tpl).toContain("ophirpay.serviceAccountName");
    expect(tpl).toContain("serviceAccount.create");
  });

  it("the deployment template references the service account name", () => {
    const deployment = read(deploymentTplPath);
    expect(deployment).toContain("serviceAccountName");
    expect(deployment).toContain("ophirpay.serviceAccountName");
  });

  it("the plain manifest path (k8s/) references the ConfigMap and Secret it ships with", () => {
    const k8sDeployment = read(k8sDeploymentPath);
    expect(k8sDeployment).toContain("configMapRef");
    expect(k8sDeployment).toContain("ophirpay-config");
    expect(k8sDeployment).toContain("secretRef");
    expect(k8sDeployment).toContain("ophirpay-secrets");
  });
});
