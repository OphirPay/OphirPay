// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HELM_JOB_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/templates/migrate-job.yaml"
);
const K8S_JOB_PATH = path.resolve(process.cwd(), "k8s/migrate-job.yaml");
const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/run-migrations.sh");

describe("Kubernetes and Helm Prisma migration job (#1335)", () => {
  const helmJob = fs.readFileSync(HELM_JOB_PATH, "utf8");
  const k8sJob = fs.readFileSync(K8S_JOB_PATH, "utf8");
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");

  it("defines a Helm pre-install,pre-upgrade hook Job running prisma migrate deploy", () => {
    expect(helmJob).toContain("kind: Job");
    expect(helmJob).toContain('"helm.sh/hook": pre-install,pre-upgrade');
    expect(helmJob).toContain(
      '"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded'
    );
    expect(helmJob).toContain('command: ["npx", "prisma", "migrate", "deploy"]');
    expect(helmJob).toContain("backoffLimit: 0");
    expect(helmJob).toContain("restartPolicy: Never");
    expect(helmJob).toContain("- secretRef:");
  });

  it("defines a standalone k8s migration Job manifest with fail-fast backoffLimit", () => {
    expect(k8sJob).toContain("kind: Job");
    expect(k8sJob).toContain("name: ophirpay-migrate");
    expect(k8sJob).toContain("backoffLimit: 0");
    expect(k8sJob).toContain('command: ["npx", "prisma", "migrate", "deploy"]');
  });

  it("provides a fail-fast run-migrations.sh script requiring DATABASE_URL", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("DATABASE_URL");
    expect(script).toContain("npx prisma migrate deploy");
  });
});
