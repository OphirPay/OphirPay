#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — Check duplicate package versions in package-lock.json (Issue #1988)
// ─────────────────────────────────────────────────────────────────────────────
// Parses package-lock.json to verify that common and critical client-side
// packages (such as React and the Stellar SDK) do not ship multiple versions
// to client browsers, and monitors lockfile deduplication health.
//
// Usage:
//   node scripts/check-duplicate-packages.mjs [options]
// Options:
//   --lockfile=<path>       Path to package-lock.json (default: ./package-lock.json)
//   --strict                Fail if any package has multiple versions
//   --critical-only         Only fail if critical packages have multiple versions
//   --max-duplicates=<num>  Maximum allowed number of duplicate packages (default: 60)
//   --json                  Output findings in JSON format
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DEFAULT_LOCKFILE = path.join(ROOT, "package-lock.json");

// Critical runtime/client libraries that must never be duplicated in client bundles
export const CRITICAL_PACKAGES = [
  "react",
  "react-dom",
  "@stellar/stellar-sdk",
  "@stellar/freighter-api",
  "next",
  "@tanstack/react-query",
];

/**
 * Parses package-lock.json and aggregates versions per package name.
 * @param {string} lockfilePath
 * @returns {Record<string, Set<string>>}
 */
export function scanLockfileForDuplicates(lockfilePath = DEFAULT_LOCKFILE) {
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`Lockfile not found at ${lockfilePath}`);
  }

  const content = fs.readFileSync(lockfilePath, "utf8");
  const lock = JSON.parse(content);
  const versionMap = {};

  if (lock.packages && typeof lock.packages === "object") {
    for (const [pkgPath, meta] of Object.entries(lock.packages)) {
      if (!pkgPath || !meta || typeof meta !== "object") continue;

      // Extract package name from node_modules path or metadata
      let name = meta.name;
      if (!name) {
        const lastNodeModules = pkgPath.lastIndexOf("node_modules/");
        if (lastNodeModules !== -1) {
          name = pkgPath.slice(lastNodeModules + "node_modules/".length);
        }
      }

      if (!name || !meta.version) continue;

      if (!versionMap[name]) {
        versionMap[name] = new Set();
      }
      versionMap[name].add(meta.version);
    }
  }

  return versionMap;
}

/**
 * Analyzes duplicates and returns summary results.
 * @param {object} options
 */
export function checkDuplicatePackages(options = {}) {
  const lockfilePath = options.lockfilePath || DEFAULT_LOCKFILE;
  const criticalList = options.criticalPackages || CRITICAL_PACKAGES;
  const maxAllowedDuplicates =
    typeof options.maxDuplicates === "number" ? options.maxDuplicates : 60;
  const strict = Boolean(options.strict);

  const versionMap = scanLockfileForDuplicates(lockfilePath);
  const allDuplicates = [];
  const criticalDuplicates = [];

  for (const [name, versionSet] of Object.entries(versionMap)) {
    if (versionSet.size > 1) {
      const entry = {
        name,
        versions: Array.from(versionSet).sort(),
        count: versionSet.size,
        isCritical: criticalList.includes(name),
      };
      allDuplicates.push(entry);
      if (entry.isCritical) {
        criticalDuplicates.push(entry);
      }
    }
  }

  // Sort duplicates by version count descending, then name
  allDuplicates.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const totalPackages = Object.keys(versionMap).length;
  const totalDuplicates = allDuplicates.length;

  let passed = true;
  const errors = [];

  if (criticalDuplicates.length > 0) {
    passed = false;
    errors.push(
      `Critical package(s) have multiple versions in lockfile: ${criticalDuplicates
        .map((d) => `${d.name} (${d.versions.join(", ")})`)
        .join("; ")}`
    );
  }

  if (strict && totalDuplicates > 0) {
    passed = false;
    errors.push(
      `Strict check enabled: found ${totalDuplicates} package(s) with duplicate versions.`
    );
  } else if (totalDuplicates > maxAllowedDuplicates) {
    passed = false;
    errors.push(
      `Lockfile has ${totalDuplicates} duplicate packages, exceeding threshold of ${maxAllowedDuplicates}. Run 'npm dedupe' to resolve.`
    );
  }

  return {
    passed,
    errors,
    totalPackages,
    totalDuplicates,
    maxAllowedDuplicates,
    criticalDuplicates,
    allDuplicates,
  };
}

// ── CLI Runner ─────────────────────────────────────────────────────────────
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = process.argv.slice(2);
  let lockfilePath = DEFAULT_LOCKFILE;
  let strict = false;
  let criticalOnly = false;
  let maxDuplicates = 60;
  let jsonOutput = false;

  for (const arg of args) {
    if (arg.startsWith("--lockfile=")) {
      lockfilePath = path.resolve(arg.slice("--lockfile=".length));
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--critical-only") {
      criticalOnly = true;
    } else if (arg.startsWith("--max-duplicates=")) {
      maxDuplicates = parseInt(arg.slice("--max-duplicates=".length), 10);
    } else if (arg === "--json") {
      jsonOutput = true;
    }
  }

  if (criticalOnly) {
    maxDuplicates = Number.MAX_SAFE_INTEGER;
  }

  try {
    const result = checkDuplicatePackages({
      lockfilePath,
      strict,
      maxDuplicates,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.passed ? 0 : 1);
    }

    console.log("══════════════════════════════════════════════════════════════════════════");
    console.log("  📦 OphirPay — Lockfile Duplicate Package Check (Issue #1988)");
    console.log("══════════════════════════════════════════════════════════════════════════");
    console.log(`Lockfile analyzed: ${path.relative(ROOT, lockfilePath) || lockfilePath}`);
    console.log(`Total unique packages: ${result.totalPackages}`);
    console.log(
      `Packages with duplicate versions: ${result.totalDuplicates} (threshold: ${maxDuplicates})`
    );

    console.log("\n🔍 Critical Client/Runtime Libraries Check:");
    for (const pkg of CRITICAL_PACKAGES) {
      const dup = result.criticalDuplicates.find((d) => d.name === pkg);
      if (dup) {
        console.log(`  ❌ ${pkg}: DUPLICATE VERSIONS DETECTED -> [${dup.versions.join(", ")}]`);
      } else {
        const found = result.allDuplicates.find((d) => d.name === pkg);
        if (!found) {
          console.log(`  ✅ ${pkg}: deduplicated (single version)`);
        }
      }
    }

    if (result.allDuplicates.length > 0) {
      console.log("\n📋 Top Duplicate Packages:");
      const preview = result.allDuplicates.slice(0, 10);
      for (const item of preview) {
        console.log(`  • ${item.name}: ${item.count} versions (${item.versions.join(", ")})`);
      }
      if (result.allDuplicates.length > 10) {
        console.log(`  ... and ${result.allDuplicates.length - 10} more duplicate packages.`);
      }
    }

    // Write to GITHUB_STEP_SUMMARY if available
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryLines = [
        "### 📦 Lockfile Duplicate Packages Report",
        "",
        `- **Total Packages:** ${result.totalPackages}`,
        `- **Duplicate Packages:** ${result.totalDuplicates} / max allowed ${maxDuplicates}`,
        `- **Status:** ${result.passed ? "✅ Passed" : "❌ Failed"}`,
        "",
        "#### Critical Packages Status",
        "| Package | Status | Versions |",
        "|---|---|---|",
        ...CRITICAL_PACKAGES.map((pkg) => {
          const dup = result.criticalDuplicates.find((d) => d.name === pkg);
          if (dup) {
            return `| \`${pkg}\` | ❌ Duplicate | ${dup.versions.join(", ")} |`;
          }
          return `| \`${pkg}\` | ✅ Single Version | Clean |`;
        }),
      ];
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join("\n") + "\n");
    }

    if (!result.passed) {
      console.error("\n❌ Duplicate check failed:");
      for (const err of result.errors) {
        console.error(`  • ${err}`);
      }
      process.exit(1);
    }

    console.log("\n✅ All critical packages deduplicated and total duplicates within budget.");
    process.exit(0);
  } catch (err) {
    console.error(`❌ Error executing duplicate package check: ${err.message}`);
    process.exit(1);
  }
}
