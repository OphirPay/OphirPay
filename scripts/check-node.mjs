#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Node.js version preflight (issue #725).
 *
 * `npm install` / `npm ci` run this through the `preinstall` script, so a
 * contributor on an unsupported Node major gets one clear, actionable message
 * instead of a pile of confusing failures from Next 16, Prisma 6 or the
 * Tailwind v4 native binaries.
 *
 * Single source of truth: `.nvmrc`. `engines.node` in `package.json` and the
 * `node-version-file: .nvmrc` input used by every workflow must agree with it —
 * `src/__tests__/node-preflight.test.ts` fails the build if they drift.
 *
 * `packageManager` drift is reported as a *warning*, not a failure: a newer npm
 * on a supported Node still installs the same lockfile, and hard-failing there
 * would block contributors for no benefit (`engine-strict` is deliberately not
 * enabled for the same reason). The warning keeps lockfile churn visible.
 *
 * Exit codes: 0 = supported, 1 = unsupported (or unreadable config).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * Major version number of a version string.
 *   "v20.11.1" -> 20 · "20" -> 20 · "20.x" -> 20 · ">=20.9" -> 20
 * Returns null when no number is present.
 */
export function majorOf(version) {
  const match = String(version ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Parse a `packageManager` field: "npm@10.8.2" -> { name: "npm", version: "10.8.2" }.
 * Returns null when the field is absent or malformed.
 */
export function parsePackageManager(value) {
  const match = String(value ?? "").match(/^([a-z]+)@(.+)$/);
  return match ? { name: match[1], version: match[2] } : null;
}

/**
 * Extract the npm version from npm's own user-agent env var, e.g.
 * "npm/10.8.2 node/v20.11.1 linux x64 workspaces/false" -> "10.8.2".
 * Returns null when the script is run outside an npm lifecycle.
 */
export function npmVersionFromUserAgent(userAgent) {
  // Requires a leading digit: a non-npm manager reports "npm/?" in its user
  // agent (e.g. "yarn/1.22.19 npm/?"), which must not read as a version.
  const match = String(userAgent ?? "").match(/(?:^|\s)npm\/(\d[^\s]*)/);
  return match ? match[1] : null;
}

/**
 * Compare a running version against the requirement. Pure, so the unit tests
 * can pin both sides without touching the real toolchain.
 */
export function evaluate({ expectedVersion, actualVersion }) {
  const expected = majorOf(expectedVersion);
  const actual = majorOf(actualVersion);
  return { ok: expected !== null && actual === expected, expected, actual };
}

/** Read the pinned requirements from `.nvmrc` and `package.json`. */
export function readRequirements(root = ROOT) {
  const nvmrc = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  return {
    nvmrc,
    enginesNode: pkg.engines?.node ?? null,
    packageManager: parsePackageManager(pkg.packageManager),
  };
}

/** Human-readable summary of the supported toolchain. */
export function describeRequirements({ nvmrc, enginesNode, packageManager }) {
  const manager = packageManager
    ? `${packageManager.name}@${packageManager.version}`
    : "npm";
  return (
    `Node ${majorOf(nvmrc) ?? nvmrc}.x ` +
    `(.nvmrc → "${nvmrc}", package.json engines.node → "${enginesNode ?? "unset"}", packageManager → "${manager}")`
  );
}

function main() {
  let requirements;
  try {
    requirements = readRequirements();
  } catch (err) {
    console.error(
      `${RED}[ERROR]${RESET} Could not read .nvmrc / package.json: ${err.message}`
    );
    process.exit(1);
  }

  const node = evaluate({
    expectedVersion: requirements.nvmrc,
    actualVersion: process.versions.node,
  });

  if (!node.ok) {
    console.error(`${RED}[ERROR]${RESET} Unsupported Node.js version.`);
    console.error(`  required : ${describeRequirements(requirements)}`);
    console.error(`  running  : Node ${process.versions.node}`);
    console.error("");
    console.error("Switch to the supported version and re-run the install:");
    console.error("  nvm install && nvm use        # reads .nvmrc");
    console.error("  fnm install && fnm use        # reads .nvmrc");
    console.error("  volta install                 # reads .nvmrc / package.json");
    console.error(
      `Or run the install with Node ${node.expected}: nvm exec npm ci`
    );
    process.exit(1);
  }

  // Advisory only — see the module docblock for why this does not fail.
  const pinned = requirements.packageManager;
  if (pinned && pinned.name === "npm") {
    const runningNpm = npmVersionFromUserAgent(process.env.npm_config_user_agent);
    const drift = evaluate({
      expectedVersion: pinned.version,
      actualVersion: runningNpm ?? pinned.version,
    });
    if (runningNpm && !drift.ok) {
      console.warn(
        `${YELLOW}[warn]${RESET} npm ${runningNpm} is running, but package.json pins npm@${pinned.version}.`
      );
      console.warn(
        `       Install with the pinned manager to avoid lockfile churn: npx npm@${pinned.version} ci`
      );
    }
  }
}

// Only run when invoked as a script (npm's preinstall), never on import.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
