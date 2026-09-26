#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Load-test baseline gate (issue #735).
 *
 * Reads the machine-readable results written by `scripts/load-test.js --json`
 * and fails when the observed p95/p99 latency or error rate exceeds the
 * deliberately maintained thresholds in `tests/load/baselines.json`.
 *
 * Why a separate gate script:
 *   • `scripts/load-test.js` and `scripts/sse-load-test.mjs` stay the single
 *     source of truth for *measuring* (the workflow runs them as they are).
 *   • The pass/fail policy — which numbers are allowed to move, and by how much
 *     — lives here and in a committed threshold file, so changing a gate is a
 *     reviewable diff instead of a workflow edit.
 *
 * Usage:
 *   node scripts/check-load-baselines.mjs [results.json]
 *
 * Env:
 *   LOAD_TEST_RESULTS   results file (default tests/load/results/latest.json)
 *   LOAD_TEST_MARGIN    multiplier applied to latency thresholds (default from
 *                       tests/load/baselines.json → margin.default)
 *   GITHUB_STEP_SUMMARY markdown report is appended here when set
 *
 * Latency thresholds are multiplied by the margin (they scale with runner
 * hardware); error-rate thresholds are absolute caps (a 0% baseline cannot be
 * scaled). See docs/PERFORMANCE.md → "Updating the baselines deliberately".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

export const DEFAULT_BASELINES_PATH = path.join("tests", "load", "baselines.json");
export const DEFAULT_RESULTS_PATH = path.join(
  "tests",
  "load",
  "results",
  "latest.json"
);

// ── Thresholds ─────────────────────────────────────────────────

/** Read + validate the threshold file. */
export function loadBaselines(file = DEFAULT_BASELINES_PATH) {
  const resolved = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!parsed.endpoints || typeof parsed.endpoints !== "object") {
    throw new Error(`${file} must define an "endpoints" object`);
  }
  return parsed;
}

/**
 * Resolve the latency margin: env var → file default → 1.
 * Rejects non-numeric or non-positive values instead of silently ignoring them.
 */
export function resolveMargin(baselines, env = process.env) {
  const raw = env.LOAD_TEST_MARGIN ?? baselines.margin?.default ?? 1;
  const margin = Number(raw);
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error(`LOAD_TEST_MARGIN must be a positive number (got "${raw}")`);
  }
  return margin;
}

// ── Evaluation ─────────────────────────────────────────────────

/**
 * Derive the measured values exactly the way `scripts/load-test.js` prints
 * them, so the gate and the console table can never disagree.
 */
export function deriveMetrics(result) {
  const connections = Math.max(1, Number(result.connections) || 1);
  const totalRequests = Number(result.requests?.total) || 0;
  return {
    p95Ms: result.latency?.p95 ?? null,
    p99Ms: result.latency?.p99 ?? null,
    errorPct: ((Number(result.errors) || 0) / connections) * 100,
    non2xxPct:
      totalRequests > 0
        ? ((Number(result.non2xx) || 0) / totalRequests) * 100
        : 0,
    sse: Boolean(result.sse),
  };
}

/**
 * Compare one measured pass with the thresholds for its endpoint.
 *
 * Returns `{ endpoint, connections, measured, checks, ok }` where each check is
 * `{ metric, measured, allowed, ok }`. Latency thresholds are scaled by
 * `margin`; error rates are compared against their absolute cap. SSE rows have
 * no latency/non-2xx numbers, so only their transport error rate is checked.
 */
export function evaluateResult(result, thresholds, margin) {
  const measured = deriveMetrics(result);
  const checks = [];

  const add = (metric, value, allowed) => {
    if (value === null || value === undefined) return;
    if (allowed === null || allowed === undefined) return;
    checks.push({ metric, measured: value, allowed, ok: Number(value) <= allowed });
  };

  add(
    "p95 latency",
    measured.p95Ms,
    thresholds.p95Ms == null ? null : thresholds.p95Ms * margin
  );
  add(
    "p99 latency",
    measured.p99Ms,
    thresholds.p99Ms == null ? null : thresholds.p99Ms * margin
  );
  add("error rate", measured.errorPct, thresholds.errorPct);
  if (!measured.sse) {
    add("non-2xx rate", measured.non2xxPct, thresholds.non2xxPct);
  }

  return {
    endpoint: result.endpoint,
    connections: Number(result.connections) || 0,
    measured,
    checks,
    ok: checks.length > 0 && checks.every((c) => c.ok),
  };
}

// ── Reporting ──────────────────────────────────────────────────

function fmt(value, metric) {
  if (value === null || value === undefined) return "n/a";
  return metric.includes("rate")
    ? `${Number(value).toFixed(2)}%`
    : `${Math.round(Number(value))} ms`;
}

/** Render the markdown report (stdout + $GITHUB_STEP_SUMMARY). */
export function renderReport(outcomes, { margin, generatedAt, breached = [] } = {}) {
  const lines = [];
  lines.push("### ⚡ Load-test baseline gate");
  lines.push("");
  lines.push(
    `Thresholds: \`tests/load/baselines.json\` · latency margin ×${margin} ` +
      "· error rates compared against absolute caps"
  );
  if (generatedAt) lines.push(`Results measured: ${generatedAt}`);
  lines.push("");
  lines.push("| Endpoint | Conns | Metric | Measured | Allowed | Result |");
  lines.push("|---|---:|---|---:|---:|---|");
  for (const outcome of outcomes) {
    if (outcome.checks.length === 0) {
      lines.push(
        `| ${outcome.endpoint} | ${outcome.connections} | — | — | — | ⚠️ no thresholds |`
      );
      continue;
    }
    for (const check of outcome.checks) {
      lines.push(
        `| ${outcome.endpoint} | ${outcome.connections} | ${check.metric} | ` +
          `${fmt(check.measured, check.metric)} | ${fmt(check.allowed, check.metric)} | ` +
          `${check.ok ? "✅" : "❌"} |`
      );
    }
  }
  lines.push("");

  const total = outcomes.reduce((sum, o) => sum + o.checks.length, 0);
  if (breached.length === 0) {
    lines.push(`✅ **${total} checks passed** — no baseline regression detected.`);
  } else {
    lines.push(
      `❌ **${breached.length} threshold breach(es) / ${total} checks** — see the rows marked ❌ above.`
    );
    for (const outcome of breached) {
      lines.push("");
      lines.push(`- \`${outcome.endpoint}\` @ ${outcome.connections} connections:`);
      for (const check of outcome.checks.filter((c) => !c.ok)) {
        lines.push(
          `  - ${check.metric} measured **${fmt(check.measured, check.metric)}**, ` +
            `allowed ${fmt(check.allowed, check.metric)}`
        );
      }
    }
    lines.push("");
    lines.push(
      "> If the regression is intentional, update the thresholds deliberately — " +
        "see docs/PERFORMANCE.md → \"Updating the baselines deliberately\"."
    );
  }
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────

function readResults(file) {
  const resolved = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const results = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`${file} contains no results`);
  }
  return { results, generatedAt: parsed.generatedAt ?? null, baseUrl: parsed.baseUrl ?? null };
}

function main() {
  const resultsFile =
    process.argv.slice(2).find((arg) => !arg.startsWith("-")) ||
    process.env.LOAD_TEST_RESULTS ||
    DEFAULT_RESULTS_PATH;

  const baselines = loadBaselines();
  const margin = resolveMargin(baselines);
  const { results, generatedAt } = readResults(resultsFile);

  const outcomes = [];
  const undocumented = new Set();

  for (const result of results) {
    const thresholds = baselines.endpoints[result.endpoint];
    if (!thresholds) {
      // A new endpoint must come with a deliberate threshold decision, never
      // silently pass through the gate unmeasured.
      undocumented.add(result.endpoint);
      continue;
    }
    outcomes.push(evaluateResult(result, thresholds, margin));
  }

  const breached = outcomes.filter((o) => !o.ok);
  const report = renderReport(outcomes, { margin, generatedAt, breached });

  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }

  if (undocumented.size > 0) {
    const list = [...undocumented].join(", ");
    console.error(
      `::error title=Load-test baseline missing::No thresholds for ${list}. ` +
        "Add them to tests/load/baselines.json (see docs/PERFORMANCE.md)."
    );
    process.exit(1);
  }

  if (breached.length > 0) {
    const headline = breached
      .flatMap((o) =>
        o.checks
          .filter((c) => !c.ok)
          .map(
            (c) =>
              `${o.endpoint}@${o.connections} ${c.metric} ${fmt(c.measured, c.metric)} > ${fmt(c.allowed, c.metric)}`
          )
      )
      .join("; ");
    console.error(`::error title=Load-test baseline exceeded::${headline}`);
    process.exit(1);
  }

  console.log(`\n✅ All ${outcomes.reduce((n, o) => n + o.checks.length, 0)} baseline checks passed.`);
}

// Only run when invoked as a script (tests import the pure helpers).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (err) {
    console.error(`Load-test baseline gate failed: ${err.message}`);
    process.exit(1);
  }
}
