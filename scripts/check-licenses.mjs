#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — Open-Source License Compliance Check (Issue #1992)
// ─────────────────────────────────────────────────────────────────────────────
// Runs license-checker to verify all production dependencies use compatible
// permissive open-source licenses (MIT, Apache-2.0, BSD, ISC, etc.) and ensures
// no copyleft (GPL, AGPL) or restrictive proprietary licenses are introduced.
//
// Usage:
//   node scripts/check-licenses.mjs [options]
// Options:
//   --summary     Print summary of licenses found
//   --json        Output report in JSON format
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

// Approved permissive open-source licenses for production dependencies
export const ALLOWED_LICENSES = [
  "MIT",
  "MIT*",
  "Apache-2.0",
  "Apache*",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "(MPL-2.0 OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
  "(MIT AND Zlib)",
  "(MIT AND BSD-3-Clause)",
];

/**
 * Runs license-checker on production dependencies with allowed license list.
 * @param {object} options
 * @returns {{ passed: boolean, output: string, error?: string }}
 */
export function runLicenseCheck(options = {}) {
  const allowed = options.allowedLicenses || ALLOWED_LICENSES;
  const onlyAllowString = allowed.join(";");

  const binPath = path.join(ROOT, "node_modules", "license-checker", "bin", "license-checker");

  const args = ["--production", "--excludePrivatePackages", "--onlyAllow", onlyAllowString];

  if (options.summary) {
    args.push("--summary");
  }
  if (options.json) {
    args.push("--json");
  }

  try {
    const stdout = execFileSync("node", [binPath, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { passed: true, output: stdout };
  } catch (err) {
    return {
      passed: false,
      output: (err.stdout || "").toString(),
      error: (err.stderr || err.message || "").toString(),
    };
  }
}

// ── CLI Runner ─────────────────────────────────────────────────────────────
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = process.argv.slice(2);
  const summary = args.includes("--summary") || !args.includes("--json");
  const json = args.includes("--json");

  console.log("══════════════════════════════════════════════════════════════════════════");
  console.log("  ⚖️  OphirPay — Open-Source License Compliance Check (Issue #1992)");
  console.log("══════════════════════════════════════════════════════════════════════════");

  const result = runLicenseCheck({ summary, json });

  if (json) {
    console.log(result.output);
  } else {
    console.log(result.output);
  }

  // Write to GITHUB_STEP_SUMMARY when in CI
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryMarkdown = [
      "### ⚖️ Open-Source License Compliance",
      "",
      `- **Status:** ${result.passed ? "✅ Compliant" : "❌ Incompatible License Detected"}`,
      "- **Allowed Categories:** MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, CC0-1.0, and compatible permissive licenses.",
      "",
      "```text",
      result.output.trim(),
      "```",
    ].join("\n");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown + "\n");
  }

  if (!result.passed) {
    console.error("\n❌ License compliance check failed:");
    console.error(result.error || result.output);
    console.error("\nIncompatible or unapproved license detected in production dependencies.");
    process.exit(1);
  }

  console.log("✅ All production dependencies comply with approved open-source licenses.");
  process.exit(0);
}
