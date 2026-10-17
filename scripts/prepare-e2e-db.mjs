// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E and Docker smoke database schema preparation helper (#1325).
 *
 * Replaces `prisma db push --skip-generate` with `prisma migrate deploy` so
 * E2E and Docker smoke runs exercise the real `prisma/migrations/` history
 * that staging and production execute. A broken or out-of-order migration
 * fails the job immediately instead of being masked by `db push`.
 */
export function buildPrismaPreparationCommand({
  allowThrowawayPush = false,
} = {}) {
  if (allowThrowawayPush) {
    // Only used when an isolated unit test explicitly requests an ephemeral
    // throwaway schema without migration history.
    return ["npx", ["prisma", "db", "push", "--skip-generate"]];
  }
  return ["npx", ["prisma", "migrate", "deploy"]];
}

export function validateMigrationsDirectory(
  migrationsDir = path.resolve(process.cwd(), "prisma/migrations")
) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Prisma migrations directory not found: ${migrationsDir}`);
  }

  const entries = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (entries.length === 0) {
    throw new Error(`No Prisma migrations found in ${migrationsDir}`);
  }

  for (const folder of entries) {
    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Missing migration.sql in ${folder}`);
    }
    const sql = fs.readFileSync(sqlPath, "utf8").trim();
    if (!sql) {
      throw new Error(`Empty migration.sql in ${folder}`);
    }
  }

  return entries;
}

export function prepareE2eDatabase({
  allowThrowawayPush = false,
  migrationsDir,
  execImpl = execFileSync,
} = {}) {
  if (!allowThrowawayPush) {
    validateMigrationsDirectory(migrationsDir);
  }
  const [cmd, args] = buildPrismaPreparationCommand({ allowThrowawayPush });
  execImpl(cmd, args, { stdio: "inherit" });
  return { command: `${cmd} ${args.join(" ")}` };
}
