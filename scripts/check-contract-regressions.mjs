#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Contract regression reporter (issues #212, #743).
 *
 * Compares the freshly built release WASM artifacts against the committed
 * baseline in `contracts/wasm-baseline.json` and reports the *delta* — size,
 * bytes and percent — not just a pass/fail, so a reviewer can judge whether
 * `+3 %` on a contract is justified.
 *
 * Outputs a markdown report to stdout, to the GitHub job summary
 * (`GITHUB_STEP_SUMMARY`) and optionally to a file (`REGRESSION_REPORT_PATH`)
 * that `.github/workflows/contract-regression.yml` posts as a PR comment.
 *
 * Usage:
 *   node scripts/check-contract-regressions.mjs
 *   WASM_SIZE_THRESHOLD_PERCENT=5 node scripts/check-contract-regressions.mjs
 *   node scripts/check-contract-regressions.mjs --update-baseline
 *   FEE_REPORT_PATH=fee-report.json node scripts/check-contract-regressions.mjs
 *
 * Exit code is non-zero when a contract exceeds the size threshold or its
 * absolute guardrail, naming the offending contract.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const updateBaseline = args.has('--update-baseline');

const baselinePath = join(root, 'contracts/wasm-baseline.json');
const feeBaselinePath = join(root, 'contracts/fee-baseline.json');

const pct = (delta, base) => (base === 0 ? (delta === 0 ? 0 : 100) : (delta / base) * 100);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const formatPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${path}): ${err.message}`);
  }
}

// ── Baseline ────────────────────────────────────────────────────────────────

const baseline = readJson(baselinePath, 'WASM baseline');
const contracts = baseline.contracts ?? {};

if (Object.keys(contracts).length === 0) {
  throw new Error(
    `${baselinePath} declares no contracts. Expected { "contracts": { "<name>": { "artifact", "baselineBytes", "maxBytes" } } }`,
  );
}

/**
 * Threshold resolution order: explicit env var → baseline file → 3 % default.
 * Set `WASM_SIZE_THRESHOLD_PERCENT` (or the `WASM_SIZE_THRESHOLD_PERCENT`
 * repository variable) to relax/tighten the gate for a single PR.
 */
const envThreshold = process.env.WASM_SIZE_THRESHOLD_PERCENT;
const thresholdPercent = Number(envThreshold ?? baseline.sizeThresholdPercent ?? 3);

if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) {
  throw new Error(
    `Invalid WASM_SIZE_THRESHOLD_PERCENT "${envThreshold}" — expected a non-negative number.`,
  );
}

// ── Size comparison ─────────────────────────────────────────────────────────

const sizeRows = [];
const failures = [];
let baselineChanged = false;

for (const [name, entry] of Object.entries(contracts)) {
  const artifact = join(root, entry.artifact ?? '');
  if (!entry.artifact || !existsSync(artifact)) {
    throw new Error(`Missing release artifact for ${name}: ${entry.artifact ?? '(unset)'}`);
  }

  const bytes = readFileSync(artifact).byteLength;
  const baselineBytes = Number.isInteger(entry.baselineBytes) ? entry.baselineBytes : null;

  if (updateBaseline) {
    if (baselineBytes !== bytes) baselineChanged = true;
    entry.baselineBytes = bytes;
  }

  const delta = baselineBytes === null ? null : bytes - baselineBytes;
  const deltaPercent = delta === null ? null : pct(delta, baselineBytes);

  sizeRows.push({
    name,
    baselineBytes,
    bytes,
    delta,
    deltaPercent,
    maxBytes: entry.maxBytes,
  });

  // Absolute guardrail — a hard ceiling that must never be crossed.
  if (Number.isInteger(entry.maxBytes) && bytes > entry.maxBytes) {
    failures.push(`${name}: WASM size ${bytes} bytes exceeds the ${entry.maxBytes}-byte guardrail`);
  }

  // Relative guardrail — fail only past the configured percentage growth.
  // Skipped while recording a new baseline: that run is deliberately absorbing
  // the growth into the committed reference numbers.
  if (!updateBaseline && deltaPercent !== null && deltaPercent > thresholdPercent) {
    failures.push(
      `${name}: WASM grew ${formatPct(deltaPercent)} (${signed(delta)} bytes: ${baselineBytes} → ${bytes}), ` +
        `over the ${thresholdPercent}% threshold`,
    );
  }
}

// ── Fee comparison (optional) ───────────────────────────────────────────────
//
// The fee assertions live in `contracts/ophirpay/tests/fee_report.rs`, which
// writes its numbers to `OPHIRPAY_FEE_REPORT_PATH` when asked. When that report
// is present we diff it against `contracts/fee-baseline.json`; when it is not,
// the section says so instead of silently omitting the data.

const feeReportPath = process.env.FEE_REPORT_PATH;
let feeRows = null;
let feeNote = null;

if (feeReportPath && existsSync(feeReportPath)) {
  const report = readJson(feeReportPath, 'fee report');
  const feeBaseline = readJson(feeBaselinePath, 'fee baseline');
  const key = (f) => `${f.amount}x${f.bps}`;

  const baselineByKey = new Map(
    (feeBaseline.fees ?? []).map((f) => [key(f), Number(f.fee)]),
  );
  const reportByKey = new Map((report.fees ?? []).map((f) => [key(f), Number(f.fee)]));

  feeRows = [];
  for (const [k, baseFee] of baselineByKey) {
    const [amount, bps] = k.split('x');
    const newFee = reportByKey.get(k);
    if (newFee === undefined) {
      feeRows.push({ amount, bps, baseFee, newFee: null, delta: null });
      failures.push(`fee assertion for amount ${amount} @ ${bps} bps is missing from the report`);
      continue;
    }
    const delta = newFee - baseFee;
    feeRows.push({ amount, bps, baseFee, newFee, delta });
    if (delta !== 0) {
      failures.push(
        `calculate_fee(${amount}, ${bps} bps) changed: ${baseFee} → ${newFee} stroops (${signed(delta)})`,
      );
    }
  }
} else {
  feeNote = feeReportPath
    ? `fee report not found at \`${feeReportPath}\` — fee delta unavailable for this run`
    : 'fee delta unavailable: set `FEE_REPORT_PATH` to the output of `cargo test --test fee_report`';
}

// ── Report ──────────────────────────────────────────────────────────────────

const lines = [
  '## Contract regression report',
  '',
  `WASM size threshold: **${thresholdPercent}%** growth vs the committed baseline ` +
    `(\`contracts/wasm-baseline.json\`). Baseline is updated only by an explicit ` +
    `\`--update-baseline\` run — see ` +
    `[docs/GAS.md](https://github.com/OphirPay/OphirPay/blob/HEAD/docs/GAS.md).`,
  '',
  '| Contract | Baseline (bytes) | New (bytes) | Δ bytes | Δ % | Absolute guardrail |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
];

for (const row of sizeRows) {
  const delta = row.delta === null ? 'n/a' : signed(row.delta);
  const deltaPct = row.deltaPercent === null ? 'n/a' : formatPct(row.deltaPercent);
  const guardrail = Number.isInteger(row.maxBytes)
    ? `${row.bytes} / ${row.maxBytes}`
    : 'unset';
  lines.push(
    `| \`${row.name}\` | ${row.baselineBytes ?? 'n/a'} | ${row.bytes} | ${delta} | ${deltaPct} | ${guardrail} |`,
  );
}

lines.push('', '### Fee assertions', '');

if (feeRows) {
  lines.push(
    '| Amount (stroops) | Fee (bps) | Baseline fee | New fee | Δ |',
    '| ---: | ---: | ---: | ---: | ---: |',
  );
  for (const row of feeRows) {
    lines.push(
      `| ${row.amount} | ${row.bps} | ${row.baseFee} | ${row.newFee ?? 'missing'} | ${
        row.delta === null ? 'n/a' : signed(row.delta)
      } |`,
    );
  }
} else {
  lines.push(`_${feeNote}._`);
}

lines.push('', '### Result', '');

if (failures.length > 0) {
  lines.push('❌ **Failed** — the following contracts need attention:', '');
  for (const failure of failures) lines.push(`- ${failure}`);
  lines.push(
    '',
    'If the growth is intentional, raise the threshold for this PR with the ',
    '`WASM_SIZE_THRESHOLD_PERCENT` repository variable, or commit the new ',
    'baseline with `node scripts/check-contract-regressions.mjs --update-baseline` ',
    'and update the size table in `docs/GAS.md`.',
  );
} else if (updateBaseline) {
  lines.push(
    '✅ **Baseline recorded** — `contracts/wasm-baseline.json` now holds the ' +
      'incoming artifact sizes, so the reported deltas above are the ones being ' +
      'absorbed into the committed reference.',
  );
} else {
  lines.push(
    `✅ **Passed** — every contract stayed within the ${thresholdPercent}% size threshold ` +
      'and no fee assertion changed.',
  );
}

if (updateBaseline) {
  lines.push(
    '',
    `> Baseline updated: \`contracts/wasm-baseline.json\` ${baselineChanged ? 'now records the freshly built artifact sizes' : 'was already current'}.`,
  );
}

const report = `${lines.join('\n')}\n`;

console.log(report);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

if (process.env.REGRESSION_REPORT_PATH) {
  writeFileSync(process.env.REGRESSION_REPORT_PATH, report);
}

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
