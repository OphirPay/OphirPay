#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — dependency vulnerability scan (CI gate)
// ─────────────────────────────────────────────────────────────────────────────
// Runs `npm audit --json`, applies the documented suppressions from
// `.github/dependency-suppressions.json`, and FAILS the build when any
// *remaining* advisory is at or above the configured severity threshold
// (default: "high" — i.e. high + critical).
//
// Output:
//   • Prints a human-readable summary to stdout.
//   • Writes the full audit report to `dependency-audit-report/` so CI can
//     upload it as an artifact (every PR + nightly).
//
// Exit codes:
//   0 — no unfixed advisories at/above the threshold (or all suppressed)
//   1 — unfixed high/critical advisories found, or the scan itself failed
//
// Suppression policy: see the "Dependency Vulnerability Policy" section of
// SECURITY.md. Suppressions are temporary, must carry a justification, and
// expire — they are NOT a way to silence new advisories.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_FILE = join(ROOT, ".github", "dependency-suppressions.json");
const REPORT_DIR = join(ROOT, "dependency-audit-report");

// Threshold above which the build fails: "high" fails on high + critical,
// "critical" fails on critical only.
const FAIL_ON = (process.env.AUDIT_FAIL_ON || "high").toLowerCase();
const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 };

if (!(FAIL_ON in SEVERITY_RANK)) {
  console.error(`[audit-dependencies] Unknown AUDIT_FAIL_ON="${FAIL_ON}" (use low|moderate|high|critical)`);
  process.exit(2);
}

// ── Suppressions ────────────────────────────────────────────────────────────

/** @returns {Array<{id?: string, package?: string, reason?: string, expires?: string, tracking?: string}>} */
function loadSuppressions() {
  if (!existsSync(SUPPRESSIONS_FILE)) return [];
  const raw = JSON.parse(readFileSync(SUPPRESSIONS_FILE, "utf8"));
  const list = Array.isArray(raw?.suppressions) ? raw.suppressions : [];
  // Fail the scan on malformed suppressions rather than silently ignoring them.
  for (const s of list) {
    if (!s || (!s.id && !s.package)) {
      throw new Error(
        `[audit-dependencies] Invalid suppression entry (need id and/or package): ${JSON.stringify(s)}`
      );
    }
  }
  return list;
}

/**
 * A finding is suppressed only when EVERY advisory behind it is covered by a
 * documented suppression — either by GHSA id (from the advisory URL) or by
 * package name (npm uses bare package-name strings in `via` for transitive
 * chains).
 */
function isSuppressed(vuln, suppressions) {
  const via = Array.isArray(vuln?.via) ? vuln.via : [];
  if (via.length === 0) return false;
  return via.every((entry) => {
    if (typeof entry === "string") {
      return suppressions.some((s) => s.package === entry);
    }
    const ghsa = entry.url
      ? String(entry.url).split("/").filter(Boolean).pop()
      : null;
    return suppressions.some(
      (s) => (s.id && ghsa && s.id === ghsa) || (s.package && s.package === entry.name)
    );
  });
}

// ── Audit run ───────────────────────────────────────────────────────────────

/** Runs `npm audit --json` and returns parsed output + the process exit code. */
function runAudit() {
  try {
    const out = execFileSync("npm", ["audit", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return { exitCode: 0, json: JSON.parse(out) };
  } catch (err) {
    // npm audit exits non-zero both when it finds vulnerabilities AND when the
    // registry is unreachable — parse whatever JSON it emitted.
    const stdout = (err.stdout || "").toString();
    try {
      return { exitCode: err.status ?? 1, json: JSON.parse(stdout) };
    } catch {
      return { exitCode: err.status ?? 1, json: null, raw: stdout + (err.stderr || "") };
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

let suppressions;
try {
  suppressions = loadSuppressions();
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}

const { exitCode, json, raw } = runAudit();

mkdirSync(REPORT_DIR, { recursive: true });
if (json) writeFileSync(join(REPORT_DIR, "audit-report.json"), JSON.stringify(json, null, 2));
if (raw) writeFileSync(join(REPORT_DIR, "audit-error.txt"), raw);

// The audit metadata (e.g. `metadata.vulnerabilities`) is trusted only as a
// quick glance — the gate below recomputes from the per-package findings.
const findings = Object.entries(json?.vulnerabilities ?? {}).map(([name, v]) => ({
  name,
  severity: v?.severity,
  via: v?.via,
}));

const suppressed = findings.filter((f) => isSuppressed(f, suppressions));
const remaining = findings.filter((f) => !isSuppressed(f, suppressions));
const failing = remaining.filter(
  (f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[FAIL_ON]
);

const lines = [];
lines.push("────────────────────────────────────────────────────────────");
lines.push("Dependency vulnerability scan");
lines.push(`  audit exit code : ${exitCode} (npm exits 1 when findings exist)`);
lines.push(`  fail threshold   : ${FAIL_ON} and above`);
lines.push(`  findings         : ${findings.length} (${suppressed.length} suppressed, ${remaining.length} remaining)`);
lines.push("────────────────────────────────────────────────────────────");

for (const f of suppressed) {
  lines.push(`  [suppressed] ${f.name} (${f.severity}) — covered by dependency-suppressions.json`);
}
for (const f of remaining) {
  lines.push(`  [${f.severity}] ${f.name}`);
  if (Array.isArray(f.via)) {
    for (const via of f.via) {
      const label = typeof via === "string" ? via : `${via.name} — ${via.title}`;
      lines.push(`      via ${label}`);
    }
  }
}

if (failing.length > 0) {
  lines.push("");
  lines.push(`❌ FAIL: ${failing.length} advisories at/above "${FAIL_ON}" are NOT suppressed.`);
  lines.push(`   Fix them (npm audit fix / upgrade), or document an accepted risk in`);
  lines.push(`   .github/dependency-suppressions.json per SECURITY.md (temporary, with expiry).`);
  lines.push(`   Full report: ${REPORT_DIR}/audit-report.json`);
  console.log(lines.join("\n"));
  process.exit(1);
}

if (json?.error) {
  lines.push("");
  lines.push(`⚠️  npm audit itself reported an error: ${json.error.summary || json.error.code || "unknown"}`);
  lines.push(`   Treating an un-scannable dependency tree as a scan failure.`);
  console.log(lines.join("\n"));
  process.exit(1);
}

lines.push("");
lines.push("✅ PASS — no unfixed advisories at/above the threshold.");
console.log(lines.join("\n"));
process.exit(0);
