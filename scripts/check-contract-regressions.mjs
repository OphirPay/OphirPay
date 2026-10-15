#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Contract storage footprint and gas regression reporter (issues #212, #743, #1408).
 *
 * Compares freshly built release WASM artifacts against the committed
 * baseline in `contracts/wasm-baseline.json` and reports deltas (size, bytes,
 * percentage), protocol limit adherence (128 KB), and fee estimates.
 *
 * Usage:
 *   node scripts/check-contract-regressions.mjs
 *   UPDATE_BASELINES=true node scripts/check-contract-regressions.mjs
 *   node scripts/check-contract-regressions.mjs --update-baseline
 *   WASM_SIZE_THRESHOLD_PERCENT=5 node scripts/check-contract-regressions.mjs
 *   FEE_REPORT_PATH=fee-report.json node scripts/check-contract-regressions.mjs
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_LIMIT_BYTES_DEFAULT = 128 * 1024; // 131,072 bytes (128 KB)

export const pct = (delta, base) => (base === 0 ? (delta === 0 ? 0 : 100) : (delta / base) * 100);
export const signed = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n > 0 ? `+${n}` : `${n}`) : 'n/a');
export const formatPct = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : 'n/a';

export function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} (${path}): ${err.message}`);
  }
}

/**
 * Compare WASM artifact sizes against baselines.
 */
export function compareWasmSizes(contracts, options = {}) {
  const {
    root = process.cwd(),
    updateBaseline = false,
    thresholdPercent = 5,
    protocolLimitBytes = PROTOCOL_LIMIT_BYTES_DEFAULT,
    failOnProtocolLimit = false,
    isCI = false,
    allowMissing = !isCI,
    readFileBytes = (p) => readFileSync(p).byteLength,
    existsFn = existsSync,
  } = options;

  const sizeRows = [];
  const failures = [];
  const warnings = [];
  const missingArtifacts = [];
  let baselineChanged = false;

  for (const [name, entry] of Object.entries(contracts)) {
    const artifactRel = entry.artifact ?? '';
    const artifactAbs = join(root, artifactRel);
    const exists = artifactRel !== '' && existsFn(artifactAbs);

    if (!exists) {
      missingArtifacts.push({ name, artifact: artifactRel });
      if (!allowMissing) {
        failures.push(`Missing release artifact for ${name}: ${artifactRel || '(unset)'}`);
      }
      sizeRows.push({
        name,
        baselineBytes: Number.isInteger(entry.baselineBytes) ? entry.baselineBytes : null,
        bytes: null,
        delta: null,
        deltaPercent: null,
        maxBytes: entry.maxBytes,
        missing: true,
      });
      continue;
    }

    const bytes = readFileBytes(artifactAbs);
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
      missing: false,
    });

    // 1. Soroban Protocol Limit Check (128 KB = 131,072 bytes)
    if (bytes > protocolLimitBytes) {
      const msg = `${name}: WASM size ${bytes} bytes exceeds Soroban protocol limit of 128 KB (${protocolLimitBytes} bytes)`;
      if (failOnProtocolLimit) {
        failures.push(msg);
      } else {
        warnings.push(msg);
      }
    }

    // 2. Absolute guardrail check
    if (Number.isInteger(entry.maxBytes) && bytes > entry.maxBytes) {
      failures.push(`${name}: WASM size ${bytes} bytes exceeds the ${entry.maxBytes}-byte guardrail`);
    }

    // 3. Relative threshold check (e.g. 5% growth)
    if (!updateBaseline && deltaPercent !== null && deltaPercent > thresholdPercent) {
      failures.push(
        `${name}: WASM grew ${formatPct(deltaPercent)} (${signed(delta)} bytes: ${baselineBytes} → ${bytes}), ` +
          `over the ${thresholdPercent}% threshold`,
      );
    }
  }

  return {
    sizeRows,
    failures,
    warnings,
    missingArtifacts,
    baselineChanged,
  };
}

/**
 * Compare fee outputs against baseline.
 */
export function compareFeeReports(feeReport, feeBaseline) {
  const feeRows = [];
  const failures = [];
  const key = (f) => `${f.amount}x${f.bps}`;

  const baselineByKey = new Map((feeBaseline.fees ?? []).map((f) => [key(f), Number(f.fee)]));
  const reportByKey = new Map((feeReport.fees ?? []).map((f) => [key(f), Number(f.fee)]));

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

  return { feeRows, failures };
}

/**
 * Build markdown report.
 */
export function buildRegressionReport(data) {
  const {
    sizeRows = [],
    feeRows = null,
    feeNote = null,
    failures = [],
    warnings = [],
    thresholdPercent = 5,
    protocolLimitBytes = PROTOCOL_LIMIT_BYTES_DEFAULT,
    updateBaseline = false,
    baselineChanged = false,
    missingArtifacts = [],
    isLocalDev = false,
  } = data;

  const lines = [
    '## Contract regression report',
    '',
    `WASM size threshold: **${thresholdPercent}%** growth vs committed baseline ` +
      `(\`contracts/wasm-baseline.json\`). Protocol limit: **${(protocolLimitBytes / 1024).toFixed(0)} KB** (${protocolLimitBytes.toLocaleString()} bytes). ` +
      `Baseline is updated only by explicit \`--update-baseline\` or \`UPDATE_BASELINES=true\` — see ` +
      `[docs/GAS.md](https://github.com/OphirPay/OphirPay/blob/HEAD/docs/GAS.md).`,
    '',
    '| Contract | Baseline (bytes) | New (bytes) | Δ bytes | Δ % | Absolute guardrail |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const row of sizeRows) {
    const newBytesStr = row.missing ? '*(not built)*' : String(row.bytes);
    const delta = row.delta == null ? 'n/a' : signed(row.delta);
    const deltaPct = row.deltaPercent == null ? 'n/a' : formatPct(row.deltaPercent);
    const guardrail = Number.isInteger(row.maxBytes)
      ? `${row.bytes ?? 'n/a'} / ${row.maxBytes}`
      : 'unset';
    lines.push(
      `| \`${row.name}\` | ${row.baselineBytes ?? 'n/a'} | ${newBytesStr} | ${delta} | ${deltaPct} | ${guardrail} |`,
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
    lines.push('❌ **Failed** — the following issues need attention:', '');
    for (const failure of failures) lines.push(`- ${failure}`);
    lines.push(
      '',
      'If the growth is intentional, raise the threshold for this PR with the ',
      '`WASM_SIZE_THRESHOLD_PERCENT` repository variable, or commit the new ',
      'baseline with `UPDATE_BASELINES=true node scripts/check-contract-regressions.mjs` ',
      'and update the size table in `docs/GAS.md`.',
    );
  } else if (updateBaseline) {
    lines.push(
      '✅ **Baseline recorded** — `contracts/wasm-baseline.json` now holds the ' +
        'incoming artifact sizes, so the reported deltas above are the ones being ' +
        'absorbed into the committed reference.',
    );
  } else if (missingArtifacts.length > 0 && isLocalDev) {
    lines.push(
      'ℹ️ **Local development environment**: release artifacts were not found locally. ' +
        'Size checks were skipped cleanly. Run `cargo build --target wasm32v1-none --release` ' +
        'inside `contracts/ophirpay` and `contracts/emitter` to compile local artifacts.',
    );
  } else {
    lines.push(
      `✅ **Passed** — every contract stayed within the ${thresholdPercent}% size threshold, ` +
        'within the protocol limit, and no fee assertion changed.',
    );
  }

  if (warnings.length > 0) {
    lines.push('', '⚠️ **Warnings**:', '');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  if (updateBaseline) {
    lines.push(
      '',
      `> Baseline updated: \`contracts/wasm-baseline.json\` ${baselineChanged ? 'now records the freshly built artifact sizes' : 'was already current'}.`,
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Main execution handler.
 */
export function runCheck(env = process.env, argv = process.argv) {
  const root = process.cwd();
  const args = new Set(argv.slice(2));

  const updateBaseline =
    args.has('--update-baseline') || env.UPDATE_BASELINES === 'true' || env.UPDATE_BASELINES === '1';

  const baselinePath = join(root, 'contracts/wasm-baseline.json');
  const feeBaselinePath = join(root, 'contracts/fee-baseline.json');

  const baseline = readJson(baselinePath, 'WASM baseline');
  const contracts = baseline.contracts ?? {};

  if (Object.keys(contracts).length === 0) {
    throw new Error(
      `${baselinePath} declares no contracts. Expected { "contracts": { "<name>": { "artifact", "baselineBytes", "maxBytes" } } }`,
    );
  }

  const rawEnv = env.WASM_SIZE_THRESHOLD_PERCENT;
  const envThreshold = rawEnv !== undefined && rawEnv.trim() !== '' ? rawEnv.trim() : null;
  const thresholdPercent = Number(envThreshold ?? baseline.sizeThresholdPercent ?? 5);

  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) {
    throw new Error(
      `Invalid WASM_SIZE_THRESHOLD_PERCENT "${envThreshold}" — expected a non-negative number.`,
    );
  }

  const protocolLimitBytes = Number(baseline.protocolLimitBytes ?? PROTOCOL_LIMIT_BYTES_DEFAULT);
  const isCI = Boolean(env.CI);
  const allowMissing = args.has('--allow-missing') || !isCI;
  const failOnProtocolLimit = env.FAIL_ON_PROTOCOL_LIMIT === 'true' || env.ENFORCE_PROTOCOL_LIMIT === 'true';

  const {
    sizeRows,
    failures: sizeFailures,
    warnings,
    missingArtifacts,
    baselineChanged,
  } = compareWasmSizes(contracts, {
    root,
    updateBaseline,
    thresholdPercent,
    protocolLimitBytes,
    failOnProtocolLimit,
    isCI,
    allowMissing,
  });

  const failures = [...sizeFailures];

  // Fee report diff
  const feeReportPath = env.FEE_REPORT_PATH;
  let feeRows = null;
  let feeNote = null;

  if (feeReportPath && existsSync(feeReportPath)) {
    const report = readJson(feeReportPath, 'fee report');
    const feeBaseline = readJson(feeBaselinePath, 'fee baseline');
    const feeResult = compareFeeReports(report, feeBaseline);
    feeRows = feeResult.feeRows;
    failures.push(...feeResult.failures);
  } else {
    feeNote = feeReportPath
      ? `fee report not found at \`${feeReportPath}\` — fee delta unavailable for this run`
      : 'fee delta unavailable: set `FEE_REPORT_PATH` to the output of `cargo test --test fee_report`';
  }

  const report = buildRegressionReport({
    sizeRows,
    feeRows,
    feeNote,
    failures,
    warnings,
    thresholdPercent,
    protocolLimitBytes,
    updateBaseline,
    baselineChanged,
    missingArtifacts,
    isLocalDev: !isCI,
  });

  console.log(report);

  if (env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${report}\n`);
    } catch {
      // Ignore if step summary write fails
    }
  }

  if (env.REGRESSION_REPORT_PATH) {
    writeFileSync(env.REGRESSION_REPORT_PATH, report);
  }

  if (updateBaseline && baselineChanged) {
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    return false;
  }

  return true;
}

// Direct execution entrypoint
const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === process.argv[1] ||
    process.argv[1].endsWith('check-contract-regressions.mjs'));

if (isMain) {
  runCheck();
}
