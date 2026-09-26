#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — Container Image Vulnerability Scan (CI gate)
// ─────────────────────────────────────────────────────────────────────────────
// Evaluates container scanner JSON results (Trivy format), applies documented
// suppressions from `.github/dependency-suppressions.json`, and FAILS the build
// when any unsuppressed advisory is at or above the configured severity
// threshold (default: "critical", configurable via CONTAINER_SCAN_FAIL_ON).
//
// Output:
//   • Prints human-readable summary naming package and CVE for findings.
//   • Writes audit summary to `container-scan-report/audit-summary.json`.
//
// Exit codes:
//   0 — no unfixed advisories at/above threshold (or all suppressed)
//   1 — unfixed critical/high advisories found, or scan/parsing failed
//   2 — invalid configuration or CLI arguments
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SUPPRESSIONS_FILE = join(ROOT, ".github", "dependency-suppressions.json");
export const DEFAULT_REPORT_DIR = join(ROOT, "container-scan-report");
export const DEFAULT_REPORT_FILE = join(DEFAULT_REPORT_DIR, "trivy-report.json");

export const SEVERITY_RANK = {
  unknown: 0,
  low: 1,
  medium: 2,
  moderate: 2,
  high: 3,
  critical: 4,
};

/**
 * Loads suppressions from file. Checks both `containerSuppressions` and `suppressions`.
 * @param {string} filePath
 * @returns {Array<{id?: string, cve?: string, package?: string, reason: string, expires?: string, tracking?: string}>}
 */
export function loadSuppressions(filePath = DEFAULT_SUPPRESSIONS_FILE) {
  if (!existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const rawList = [
    ...(Array.isArray(raw?.containerSuppressions) ? raw.containerSuppressions : []),
    ...(Array.isArray(raw?.suppressions) ? raw.suppressions : []),
  ];
  const list = rawList.filter((s) => s && (!s.$comment || s.id || s.cve || s.package));

  for (const s of list) {
    if (!s || (!s.id && !s.cve && !s.package)) {
      throw new Error(
        `[audit-container-image] Invalid suppression entry (need id/cve and/or package): ${JSON.stringify(s)}`
      );
    }
    if (!s.reason || typeof s.reason !== "string" || !s.reason.trim()) {
      throw new Error(
        `[audit-container-image] Suppression entry missing required 'reason': ${JSON.stringify(s)}`
      );
    }
  }
  return list;
}

/**
 * Determines whether a vulnerability is suppressed by an active, unexpired suppression.
 *
 * @param {{ VulnerabilityID?: string, PkgName?: string, Severity?: string }} vuln
 * @param {Array<any>} suppressions
 * @param {Date} [now]
 * @returns {{ suppressed: boolean, reason?: string, expired?: boolean, match?: any }}
 */
export function isVulnerabilitySuppressed(vuln, suppressions, now = new Date()) {
  const vulnId = (vuln.VulnerabilityID || "").trim().toLowerCase();
  const pkgName = (vuln.PkgName || "").trim().toLowerCase();

  for (const s of suppressions) {
    const sId = (s.id || s.cve || "").trim().toLowerCase();
    const sPkg = (s.package || "").trim().toLowerCase();

    // Check match by ID / CVE or package name
    const idMatches = sId && vulnId && sId === vulnId;
    const pkgMatches = sPkg && pkgName && sPkg === pkgName;

    // If both specified, both must match. If only one specified, that one matches.
    const isMatch = sId && sPkg ? idMatches && pkgMatches : idMatches || pkgMatches;

    if (isMatch) {
      if (s.expires) {
        const expDate = new Date(s.expires);
        if (!isNaN(expDate.getTime()) && expDate.getTime() < now.getTime()) {
          return { suppressed: false, expired: true, match: s };
        }
      }
      return { suppressed: true, reason: s.reason, match: s };
    }
  }

  return { suppressed: false };
}

/**
 * Analyzes container scan results and returns categorized findings.
 *
 * @param {object} reportJson
 * @param {object} [options]
 * @param {string} [options.failOn="critical"]
 * @param {Array<any>} [options.suppressions=[]]
 * @param {Date} [options.now=new Date()]
 */
export function auditContainerReport(reportJson, options = {}) {
  const failOn = (options.failOn || "critical").toLowerCase();
  const suppressions = options.suppressions || [];
  const now = options.now || new Date();

  if (!(failOn in SEVERITY_RANK)) {
    throw new Error(
      `[audit-container-image] Invalid fail-on threshold: "${failOn}". Valid: ${Object.keys(SEVERITY_RANK).join(", ")}`
    );
  }

  const thresholdRank = SEVERITY_RANK[failOn];
  const results = Array.isArray(reportJson?.Results) ? reportJson.Results : [];

  const allFindings = [];
  const suppressed = [];
  const failing = [];
  const belowThreshold = [];
  const expiredSuppressions = [];

  for (const target of results) {
    const targetName = target.Target || "container_image";
    const vulns = Array.isArray(target.Vulnerabilities) ? target.Vulnerabilities : [];

    for (const v of vulns) {
      const severity = (v.Severity || "unknown").toLowerCase();
      const rank = SEVERITY_RANK[severity] ?? 0;
      const finding = {
        target: targetName,
        targetType: target.Type || target.Class || "unknown",
        package: v.PkgName || "unknown",
        cve: v.VulnerabilityID || "UNKNOWN-CVE",
        severity: (v.Severity || "UNKNOWN").toUpperCase(),
        installedVersion: v.InstalledVersion || "unknown",
        fixedVersion: v.FixedVersion || null,
        title: v.Title || v.Description || "",
        primaryUrl: v.PrimaryURL || null,
        rank,
      };

      allFindings.push(finding);

      const check = isVulnerabilitySuppressed(v, suppressions, now);
      if (check.suppressed) {
        suppressed.push({ ...finding, suppressionReason: check.reason, suppression: check.match });
      } else {
        if (check.expired) {
          expiredSuppressions.push({ ...finding, expiredSuppression: check.match });
        }
        if (rank >= thresholdRank) {
          failing.push(finding);
        } else {
          belowThreshold.push(finding);
        }
      }
    }
  }

  return {
    failOn,
    thresholdRank,
    targetsScanned: results.length,
    totalFindings: allFindings.length,
    suppressedCount: suppressed.length,
    failingCount: failing.length,
    belowThresholdCount: belowThreshold.length,
    suppressed,
    failing,
    belowThreshold,
    expiredSuppressions,
  };
}

/**
 * Main execution entry point for CLI.
 */
export async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(`Usage: node scripts/audit-container-image.mjs [path-to-trivy-report.json]
Environment variables:
  CONTAINER_SCAN_FAIL_ON  Severity threshold to fail build (default: "critical", options: low|medium|high|critical)
  SUPPRESSIONS_FILE       Path to dependency suppressions JSON (default: .github/dependency-suppressions.json)
`);
    process.exit(0);
  }

  const reportPath = args[0] || DEFAULT_REPORT_FILE;
  const suppressionsPath = process.env.SUPPRESSIONS_FILE || DEFAULT_SUPPRESSIONS_FILE;
  const failOn = (process.env.CONTAINER_SCAN_FAIL_ON || "critical").toLowerCase();

  let suppressions = [];
  try {
    suppressions = loadSuppressions(suppressionsPath);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }

  if (!existsSync(reportPath)) {
    console.error(`[audit-container-image] Report file not found at: ${reportPath}`);
    console.error(`Ensure Trivy or your container scanner ran with --output ${reportPath}`);
    process.exit(1);
  }

  let reportJson;
  try {
    const raw = readFileSync(reportPath, "utf8");
    reportJson = JSON.parse(raw);
  } catch (err) {
    console.error(`[audit-container-image] Failed to parse JSON report at ${reportPath}: ${err.message}`);
    process.exit(1);
  }

  const audit = auditContainerReport(reportJson, { failOn, suppressions });

  const lines = [];
  lines.push("────────────────────────────────────────────────────────────");
  lines.push("Container Image Vulnerability Scan (Issue #756)");
  lines.push(`  Report file      : ${reportPath}`);
  lines.push(`  Fail threshold   : ${audit.failOn} and above`);
  lines.push(`  Targets scanned  : ${audit.targetsScanned}`);
  lines.push(
    `  Findings         : ${audit.totalFindings} (${audit.suppressedCount} suppressed, ${audit.failingCount} failing, ${audit.belowThresholdCount} below threshold)`
  );
  lines.push("────────────────────────────────────────────────────────────");

  if (audit.expiredSuppressions.length > 0) {
    lines.push("");
    lines.push("⚠️  EXPIRED SUPPRESSIONS DETECTED:");
    for (const exp of audit.expiredSuppressions) {
      lines.push(
        `   • Package: ${exp.package} | CVE: ${exp.cve} | Expired on: ${exp.expiredSuppression.expires}`
      );
    }
  }

  if (audit.suppressed.length > 0) {
    lines.push("");
    lines.push("Suppressed findings:");
    for (const s of audit.suppressed) {
      lines.push(`  [suppressed] ${s.package} (${s.cve}) [${s.severity}]`);
      lines.push(`      Reason: ${s.suppressionReason}`);
    }
  }

  if (audit.failing.length > 0) {
    lines.push("");
    lines.push(`❌ FAIL: ${audit.failing.length} vulnerability findings at/above "${audit.failOn}" in container image:`);
    for (const f of audit.failing) {
      lines.push(`  • Package: ${f.package}`);
      lines.push(`    CVE: ${f.cve}`);
      lines.push(`    Severity: ${f.severity}`);
      lines.push(`    Installed: ${f.installedVersion}${f.fixedVersion ? ` (Fixed in: ${f.fixedVersion})` : ""}`);
      lines.push(`    Target: ${f.target} (${f.targetType})`);
      if (f.title) lines.push(`    Title: ${f.title}`);
      if (f.primaryUrl) lines.push(`    Advisory: ${f.primaryUrl}`);
      lines.push("");
    }
    lines.push(`Fix these findings in Dockerfile or dependencies, or add a reviewed suppression in`);
    lines.push(`${suppressionsPath} under 'containerSuppressions' with reason and expiry.`);

    console.log(lines.join("\n"));

    // Write summary report
    mkdirSync(DEFAULT_REPORT_DIR, { recursive: true });
    writeFileSync(
      join(DEFAULT_REPORT_DIR, "audit-summary.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          status: "FAIL",
          failOn: audit.failOn,
          failingCount: audit.failingCount,
          failing: audit.failing,
          suppressedCount: audit.suppressedCount,
        },
        null,
        2
      )
    );

    process.exit(1);
  }

  lines.push("");
  lines.push(`✅ PASS — no unfixed container image vulnerabilities at or above "${audit.failOn}".`);
  console.log(lines.join("\n"));

  mkdirSync(DEFAULT_REPORT_DIR, { recursive: true });
  writeFileSync(
    join(DEFAULT_REPORT_DIR, "audit-summary.json"),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        status: "PASS",
        failOn: audit.failOn,
        failingCount: 0,
        suppressedCount: audit.suppressedCount,
      },
      null,
      2
    )
  );

  process.exit(0);
}

// Execute main if run directly
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error("[audit-container-image] Unhandled error:", err);
    process.exit(1);
  });
}
