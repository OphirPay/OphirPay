#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Point git at the versioned `.githooks/` directory (issue #1398).
 *
 * Runs from `npm run prepare`, so `npm install` / `npm ci` arms the
 * pre-commit secret scan for every developer automatically. Using
 * `core.hooksPath` (git ≥ 2.9) avoids a husky-style dependency and avoids
 * copying files into `.git/hooks` where they cannot be reviewed.
 *
 * Best-effort by design: a tarball install, a vendored checkout, a machine
 * without git, or no `.git` directory must never fail `npm install`. Every
 * failure path exits 0 with a short explanation.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = ".githooks";
const PRE_COMMIT = join(REPO_ROOT, HOOKS_DIR, "pre-commit");

/** Run git, returning trimmed stdout or null if the command fails. */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function main() {
  if (!existsSync(join(REPO_ROOT, ".git"))) {
    console.log("[git-hooks] No .git directory — skipping hook install.");
    return;
  }
  if (!existsSync(PRE_COMMIT)) {
    console.warn(`[git-hooks] ${HOOKS_DIR}/pre-commit not found — nothing to install.`);
    return;
  }

  // Hooks must be executable; a checkout can lose the bit on some filesystems.
  try {
    chmodSync(PRE_COMMIT, 0o755);
  } catch {
    // Non-fatal — git only needs read + execute, and may already be set.
  }

  if (git(["config", "--get", "core.hooksPath"]) === HOOKS_DIR) {
    console.log("[git-hooks] Pre-commit secret scan already enabled.");
    return;
  }

  if (git(["config", "core.hooksPath", HOOKS_DIR]) === null) {
    console.warn("[git-hooks] Could not set core.hooksPath — enable the hook manually:");
    console.warn(`[git-hooks]   git config core.hooksPath ${HOOKS_DIR}`);
    return;
  }

  console.log(
    `[git-hooks] ✅ Pre-commit secret scan enabled (core.hooksPath → ${HOOKS_DIR}).`
  );
}

try {
  main();
} catch (error) {
  console.warn("[git-hooks] Skipping hook install:", String(error));
}

// Never fail `npm install` because of hook wiring.
process.exit(0);
