#!/usr/bin/env node
/**
 * Gas / WASM-size regression checker for OphirPay Soroban contracts.
 *
 * Records baseline sizes of the committed Soroban .wasm artifacts, then fails
 * CI when any artifact grows beyond the configured threshold. The .wasm files
 * are checked into the repo under contracts/crate/target/wasm32-unknown-unknown/release/,
 * so no toolchain is required to measure them — we diff sizes directly.
 *
 * Usage:
 *   node scripts/check-gas-regression.cjs --record [--if-missing]
 *   node scripts/check-gas-regression.cjs --check
 */
const fs = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(process.cwd(), 'contracts', 'gas-baseline.json');
const THRESHOLD_PERCENT = parseInt(process.env.GAS_THRESHOLD_PERCENT || '5', 10);

// Find all committed wasm artifacts (bounded depth, sorted for determinism)
function findWasms() {
  const results = [];
  const roots = ['contracts'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of walk(root)) {
      const releaseDir = path.join(dir, 'target', 'wasm32-unknown-unknown', 'release');
      if (!fs.existsSync(releaseDir)) continue;
      for (const f of fs.readdirSync(releaseDir)) {
        if (f.endsWith('.wasm')) results.push(path.join(releaseDir, f));
      }
    }
  }
  return results.sort();
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield full;
      yield* walk(full);
    }
  }
}

function currentSizes() {
  const out = {};
  for (const f of findWasms()) {
    const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
    out[rel] = fs.statSync(f).size;
  }
  return out;
}

function pctChange(cur, base) {
  if (base === 0) return cur === 0 ? 0 : Infinity;
  return ((cur - base) / base) * 100;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
}

function saveBaseline(sizes) {
  const baseline = { version: '1', thresholdPercent: THRESHOLD_PERCENT, wasmSizes: sizes };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline recorded → ${BASELINE_FILE}`);
}

function main() {
  const args = process.argv.slice(2);
  const recordMode = args.includes('--record');
  const ifMissing = args.includes('--if-missing');
  const current = currentSizes();

  if (Object.keys(current).length === 0) {
    console.error('No .wasm artifacts found. Build contracts first or check paths.');
    process.exit(1);
  }

  if (recordMode) {
    const existing = loadBaseline();
    if (ifMissing && existing) {
      console.log('Baseline already exists — skipping (--if-missing).');
      return;
    }
    saveBaseline(current);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error('No baseline found. Run: node scripts/check-gas-regression.cjs --record --if-missing');
    process.exit(1);
  }

  const threshold = baseline.thresholdPercent ?? THRESHOLD_PERCENT;
  const baseSizes = baseline.wasmSizes || {};
  const failures = [];
  const summary = [];

  // Files in both baseline and current
  for (const [rel, baseSize] of Object.entries(baseSizes)) {
    if (!(rel in current)) {
      summary.push(`${rel}: REMOVED (was ${baseSize} bytes)`);
      continue;
    }
    const change = pctChange(current[rel], baseSize);
    summary.push(`${rel}: ${baseSize} → ${current[rel]} bytes (${change.toFixed(2)}%)`);
    if (change > threshold) {
      failures.push(`${rel} grew ${change.toFixed(2)}% (threshold ${threshold}%)`);
    }
  }
  // New files
  for (const rel of Object.keys(current)) {
    if (!(rel in baseSizes)) summary.push(`${rel}: NEW (${current[rel]} bytes)`);
  }

  const summaryText = ['## Gas / WASM Regression Summary', ...summary.map((s) => `- ${s}`)].join('\n');
  fs.writeFileSync('gas-summary.md', summaryText + '\n');
  console.log(summaryText);

  if (failures.length > 0) {
    console.error('\nWASM/gas regression detected:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\nNo WASM/gas regressions detected.');
}

main();
