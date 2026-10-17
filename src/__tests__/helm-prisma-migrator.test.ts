// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Prisma migration Docker target & Helm Job (#1335)", () => {
  it("defines a dedicated migrator stage in Dockerfile while keeping runner as the final stage", () => {
    const dockerfile = read("Dockerfile");
    const stages = Array.from(
      dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\w+)/gm),
      (m) => m[1],
    );

    expect(stages).toContain("migrator");
    expect(stages[stages.length - 1]).toBe("runner");

    expect(dockerfile).toContain(
      "COPY --chown=node:node --from=builder /app/prisma ./prisma",
    );
    expect(dockerfile).toContain('CMD ["npx", "prisma", "migrate", "deploy"]');
  });

  it("wires migrations configuration in helm/ophirpay/values.yaml and helm/ophirpay/templates/migrate-job.yaml", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      migrations: {
        enabled: boolean;
        backoffLimit: number;
        activeDeadlineSeconds: number;
      };
    };

    expect(values.migrations).toBeDefined();
    expect(values.migrations.enabled).toBe(true);
    expect(values.migrations.backoffLimit).toBe(3);

    const migrateJobPath = path.join(
      ROOT,
      "helm/ophirpay/templates/migrate-job.yaml",
    );
    expect(existsSync(migrateJobPath)).toBe(true);

    const template = read("helm/ophirpay/templates/migrate-job.yaml");
    expect(template).toMatch(/^\{\{-\s*if\s+\.Values\.migrations\.enabled\s*\}\}/);
    expect(template.trimEnd().endsWith("{{- end }}")).toBe(true);
    expect(template).toContain("kind: Job");
    expect(template).toContain('"helm.sh/hook": pre-install,pre-upgrade');
    expect(template).toContain(
      '"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded',
    );
    expect(template).toContain('command: ["npx", "prisma", "migrate", "deploy"]');
    expect(template).toContain("key: DATABASE_URL");
    expect(template).toContain("type: RuntimeDefault");
    expect(template).toContain("allowPrivilegeEscalation: false");
    expect(template).toContain("readOnlyRootFilesystem: true");
  });

  it("documents the migrator Docker target in docs/DEPLOYMENT.md", () => {
    const deploymentDoc = read("docs/DEPLOYMENT.md");
    expect(deploymentDoc).toContain("--target migrator");
    expect(deploymentDoc).toContain("migrator");
  });
});
