// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("Prisma migration deployment wiring (#1335)", () => {
  it("keeps Helm migrations opt-in by default", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      migrations: { enabled: boolean; backoffLimit: number };
    };

    expect(values.migrations.enabled).toBe(false);
    expect(values.migrations.backoffLimit).toBe(0);
  });

  it("runs migrations before install or upgrade and uses the app database Secret", () => {
    const job = read("helm/ophirpay/templates/migrate-job.yaml");

    expect(job).toContain("if .Values.migrations.enabled");
    expect(job).toContain("pre-install,pre-upgrade");
    expect(job).toContain('"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded');
    expect(job).toContain("include \"ophirpay.secretName\" .");
    expect(job).toContain("key: DATABASE_URL");
    expect(job).toContain(".Values.migrations.backoffLimit");
  });

  it("uses a separately published Prisma CLI image while keeping the runner separate", () => {
    const dockerfile = read("Dockerfile");
    const migratorStart = dockerfile.indexOf("AS migrator");
    const runnerStart = dockerfile.indexOf("AS runner");

    expect(migratorStart).toBeGreaterThan(-1);
    expect(runnerStart).toBeGreaterThan(migratorStart);
    expect(dockerfile.slice(migratorStart, runnerStart)).toContain("/app/node_modules/.bin/prisma");
    expect(dockerfile.slice(runnerStart)).not.toContain("node_modules/.bin/prisma");
  });

  it("provides a Compose profile using the migrator target", () => {
    const compose = load(read("docker-compose.yml")) as {
      services: { migrator: { build: { target: string }; profiles: string[] } };
    };

    expect(compose.services.migrator.build.target).toBe("migrator");
    expect(compose.services.migrator.profiles).toContain("migrations");
  });
});