// SPDX-License-Identifier: MIT

/**
 * Issue #1335 — Run Prisma migrations on a Kubernetes deploy via Helm hook.
 *
 * The runner stage of Dockerfile intentionally omits Prisma CLI for security
 * and footprint reasons. Migrations must be run via a dedicated `migrator`
 * build target in Docker and a `pre-install,pre-upgrade` Helm hook Job.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const repoRoot = process.cwd();
const dockerfilePath = join(repoRoot, "Dockerfile");
const chartDir = join(repoRoot, "helm", "ophirpay");
const migrateJobPath = join(chartDir, "templates", "migrate-job.yaml");
const valuesPath = join(chartDir, "values.yaml");
const ciWorkflowPath = join(repoRoot, ".github", "workflows", "ci.yml");
const deploymentDocPath = join(repoRoot, "docs", "DEPLOYMENT.md");

describe("Dockerfile migrator target (#1335)", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  it("declares a dedicated migrator build stage", () => {
    expect(dockerfile).toContain("FROM node:24-slim AS migrator");
    expect(dockerfile).toContain('ENTRYPOINT ["npx", "prisma", "migrate", "deploy"]');
  });

  it("keeps the runner stage CLI-free", () => {
    const runnerSection = dockerfile.match(/FROM node:24-slim AS runner([\s\S]*?)CMD \["server\.js"\]/)?.[1] ?? "";
    expect(runnerSection).toContain("Prisma query engine — copy only the native binary, not the whole CLI");
    expect(runnerSection).not.toContain("npx prisma");
    expect(runnerSection).not.toContain("prisma migrate");
  });
});

describe("helm/ophirpay migration hook Job (#1335)", () => {
  it("provides templates/migrate-job.yaml template", () => {
    expect(existsSync(migrateJobPath)).toBe(true);
    const jobTemplate = readFileSync(migrateJobPath, "utf8");

    expect(jobTemplate).toContain("{{- if .Values.migrations.enabled }}");
    expect(jobTemplate).toContain("kind: Job");
    expect(jobTemplate).toContain('"helm.sh/hook": pre-install,pre-upgrade');
    expect(jobTemplate).toContain('"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded');
    expect(jobTemplate).toContain('command: ["npx", "prisma", "migrate", "deploy"]');
    expect(jobTemplate).toContain("name: DATABASE_URL");
  });

  it("configures migrations in values.yaml disabled by default", () => {
    const values = load(readFileSync(valuesPath, "utf8")) as {
      migrations?: { enabled?: boolean; backoffLimit?: number };
    };
    expect(values.migrations).toBeDefined();
    expect(values.migrations?.enabled).toBe(false);
    expect(values.migrations?.backoffLimit).toBe(2);
  });
});

describe("CI workflow and documentation (#1335)", () => {
  it("includes migrations assertions in .github/workflows/ci.yml", () => {
    const ciContent = readFileSync(ciWorkflowPath, "utf8");
    expect(ciContent).toContain("--set migrations.enabled=true");
    expect(ciContent).toContain('expect "kind: Job" /tmp/enabled.yaml');
    expect(ciContent).toContain('reject "kind: Job" /tmp/disabled.yaml');
  });

  it("documents migrator image and Helm hook in docs/DEPLOYMENT.md", () => {
    const docContent = readFileSync(deploymentDocPath, "utf8");
    expect(docContent).toContain("Database Migrations in Kubernetes (Helm Hook)");
    expect(docContent).toContain("docker build --target migrator");
    expect(docContent).toContain("--set migrations.enabled=true");
  });
});
