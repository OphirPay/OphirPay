// SPDX-License-Identifier: MIT
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildPrismaPreparationCommand,
  prepareE2eDatabase,
  validateMigrationsDirectory,
} from "../../scripts/prepare-e2e-db.mjs";

const DOCKER_COMPOSE_PATH = path.resolve(process.cwd(), "docker-compose.yml");

describe("E2E and Docker smoke Prisma migration deployment (#1325)", () => {
  it("configures docker-compose.yml with a migrate service running prisma migrate deploy before app startup", () => {
    const compose = fs.readFileSync(DOCKER_COMPOSE_PATH, "utf8");
    expect(compose).toContain("migrate:");
    expect(compose).toContain('command: ["npx", "prisma", "migrate", "deploy"]');
    expect(compose).toContain("condition: service_completed_successfully");
  });

  it("uses prisma migrate deploy by default instead of prisma db push", () => {
    expect(buildPrismaPreparationCommand()).toEqual([
      "npx",
      ["prisma", "migrate", "deploy"],
    ]);

    const execMock = vi.fn();
    const res = prepareE2eDatabase({ execImpl: execMock });
    expect(res.command).toBe("npx prisma migrate deploy");
    expect(execMock).toHaveBeenCalledWith(
      "npx",
      ["prisma", "migrate", "deploy"],
      expect.objectContaining({ stdio: "inherit" })
    );
  });

  it("fails fast when a migration folder is missing or has an empty migration.sql", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ophirpay-mig-1325-"));
    try {
      const brokenDir = path.join(tmpDir, "20261017000000_broken");
      fs.mkdirSync(brokenDir, { recursive: true });

      expect(() => validateMigrationsDirectory(tmpDir)).toThrow(
        /Missing migration\.sql/
      );

      fs.writeFileSync(path.join(brokenDir, "migration.sql"), "   \n");
      expect(() => validateMigrationsDirectory(tmpDir)).toThrow(
        /Empty migration\.sql/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
