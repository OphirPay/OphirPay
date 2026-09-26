// SPDX-License-Identifier: MIT
//
// Content tests for the Kubernetes and Helm deployment guide (issue #785).
// Verifies documentation of required values, secret provisioning, the Next.js
// build-time inlining caveat, migration strategies, probe behaviors, pre-flight
// checklists, and cross-document navigation links.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const k8sDocPath = path.join(root, "docs", "KUBERNETES.md");
const deploymentDocPath = path.join(root, "docs", "DEPLOYMENT.md");
const readmePath = path.join(root, "README.md");
const valuesPath = path.join(root, "helm", "ophirpay", "values.yaml");
const k8sDeploymentPath = path.join(root, "k8s", "deployment.yaml");

describe("docs/KUBERNETES.md (Kubernetes & Helm deployment guide)", () => {
  it("exists and is non-empty", () => {
    expect(existsSync(k8sDocPath)).toBe(true);
    const content = readFileSync(k8sDocPath, "utf8");
    expect(content.length).toBeGreaterThan(1000);
  });

  const doc = existsSync(k8sDocPath) ? readFileSync(k8sDocPath, "utf8") : "";

  it("lists required values and secrets (DATABASE_URL, AUTH_SECRET, contract IDs)", () => {
    expect(doc).toMatch(/DATABASE_URL/);
    expect(doc).toMatch(/AUTH_SECRET/);
    expect(doc).toMatch(/NEXT_PUBLIC_CONTRACT_ID/);
    expect(doc).toMatch(/NEXT_PUBLIC_EMITTER_CONTRACT_ID/);
  });

  it("documents secret provisioning strategies (CLI flags, external secrets, pre-created Secret)", () => {
    expect(doc).toMatch(/--set-string secrets\.DATABASE_URL/);
    expect(doc).toMatch(/ophirpay-secrets/);
    expect(doc).toMatch(/External Secrets|Sealed Secrets|Vault/i);
  });

  it("prominently states the build-time versus runtime NEXT_PUBLIC_* inlining caveat", () => {
    expect(doc).toMatch(/BUILD-TIME/i);
    expect(doc).toMatch(/NEXT_PUBLIC_/);
    expect(doc).toMatch(/inlines? .*next build.* time/i);
    expect(doc).toMatch(/docker build/);
    expect(doc).toMatch(/--build-arg/);
  });

  it("documents migration strategies as a Job and initContainer", () => {
    expect(doc).toMatch(/prisma migrate deploy/);
    expect(doc).toMatch(/kind:\s*Job/);
    expect(doc).toMatch(/initContainers/);
  });

  it("documents the liveness versus readiness probe separation", () => {
    expect(doc).toMatch(/\/api\/health\/live/);
    expect(doc).toMatch(/\/api\/health\b/);
    expect(doc).toMatch(/Liveness/);
    expect(doc).toMatch(/Readiness/);
    expect(doc).toMatch(/503/);
  });

  it("includes a pre-flight checklist with linting and dry-run rendering commands", () => {
    expect(doc).toMatch(/Pre-Flight Checklist/i);
    expect(doc).toMatch(/helm lint/);
    expect(doc).toMatch(/helm template/);
    expect(doc).toMatch(/--validate/);
  });

  it("notes that the chart is provided as a starting point / reference architecture", () => {
    expect(doc).toMatch(/reference architecture and starting point/i);
  });
});

describe("Kubernetes documentation cross-links", () => {
  it("is linked from docs/DEPLOYMENT.md", () => {
    const deploymentDoc = existsSync(deploymentDocPath)
      ? readFileSync(deploymentDocPath, "utf8")
      : "";
    expect(deploymentDoc).toMatch(/KUBERNETES\.md/);
  });

  it("is linked from README.md", () => {
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    expect(readme).toMatch(/docs\/KUBERNETES\.md/);
  });

  it("manifests align with documented probe paths", () => {
    const values = existsSync(valuesPath) ? readFileSync(valuesPath, "utf8") : "";
    const k8sManifest = existsSync(k8sDeploymentPath)
      ? readFileSync(k8sDeploymentPath, "utf8")
      : "";

    expect(values).toMatch(/path:\s*\/api\/health\/live/);
    expect(values).toMatch(/path:\s*\/api\/health\b/);
    expect(k8sManifest).toMatch(/path:\s*\/api\/health\/live/);
    expect(k8sManifest).toMatch(/path:\s*\/api\/health\b/);
  });
});
