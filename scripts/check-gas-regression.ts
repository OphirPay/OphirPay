/**
 * Gas regression checker for OphirPay contracts.
 *
 * Records baseline WASM sizes + per-entrypoint fee assertions, then fails
 * CI when values grow beyond the configured threshold.
 *
 * Usage:
 *   npm run gas:record [-- --if-missing]   # write baseline (only if missing w/ flag)
 *   npm run gas:check                       # compare current vs baseline, exit 1 on growth
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Configuration
const BASELINE_FILE = path.join(process.cwd(), 'contracts', 'gas-baseline.json');
const WASM_PATH = path.join(process.cwd(), 'build', 'contract.wasm'); // adjust per project
const GAS_REPORT_CMD = 'npm run test:gas -- --json'; // must output JSON with { entrypoints: { name: gas } }
const THRESHOLD_PERCENT = parseInt(process.env.GAS_THRESHOLD_PERCENT || '5', 10);

interface Baseline {
  version: string;
  thresholdPercent?: number;
  wasmSize: number;
  entrypoints: Record<string, number>;
}

interface CurrentData {
  wasmSize: number;
  entrypoints: Record<string, number>;
}

function getCurrentData(): CurrentData {
  // Get WASM size
  let wasmSize = 0;
  if (fs.existsSync(WASM_PATH)) {
    wasmSize = fs.statSync(WASM_PATH).size;
  } else {
    console.warn(`WASM file not found at ${WASM_PATH}, building...`);
    execSync('npm run build', { stdio: 'inherit' });
    if (!fs.existsSync(WASM_PATH)) {
      throw new Error(`WASM file still not found after build: ${WASM_PATH}`);
    }
    wasmSize = fs.statSync(WASM_PATH).size;
  }

  // Get gas fees per entrypoint
  let gasJson: string;
  try {
    gasJson = execSync(GAS_REPORT_CMD, { encoding: 'utf-8' });
  } catch (error) {
    console.error('Failed to run gas report command:', error);
    process.exit(1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(gasJson);
  } catch (e) {
    throw new Error(`Gas report output is not valid JSON: ${gasJson}`);
  }

  const entrypoints: Record<string, number> = parsed.entrypoints || {};
  if (Object.keys(entrypoints).length === 0) {
    throw new Error('No entrypoints found in gas report. Ensure the test outputs entrypoints.');
  }

  return { wasmSize, entrypoints };
}

function pctChange(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 0 : Infinity;
  return ((current - baseline) / baseline) * 100;
}

function loadBaseline(): Baseline | null {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
}

function saveBaseline(data: CurrentData) {
  const baseline: Baseline = {
    version: '1',
    thresholdPercent: THRESHOLD_PERCENT,
    wasmSize: data.wasmSize,
    entrypoints: data.entrypoints,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline recorded → ${BASELINE_FILE}`);
}

function main() {
  const args = process.argv.slice(2);
  const recordMode = args.includes('--record');
  const ifMissing = args.includes('--if-missing');
  const checkMode = args.includes('--check');

  const current = getCurrentData();
  const baseline = loadBaseline();

  if (recordMode) {
    if (ifMissing && baseline) {
      console.log('Baseline already exists — skipping record (--if-missing).');
    } else {
      saveBaseline(current);
    }
    return;
  }

  if (!baseline) {
    console.error('No baseline found. Run: npm run gas:record -- --if-missing');
    process.exit(1);
  }

  const threshold = baseline.thresholdPercent ?? THRESHOLD_PERCENT;
  const failures: string[] = [];
  const summary: string[] = [];

  // WASM size check
  const wasmChange = pctChange(current.wasmSize, baseline.wasmSize);
  summary.push(`WASM size: ${baseline.wasmSize} → ${current.wasmSize} (${wasmChange.toFixed(2)}%)`);
  if (wasmChange > threshold) {
    failures.push(`WASM size grew ${wasmChange.toFixed(2)}% (threshold ${threshold}%)`);
  }

  // Entrypoint gas checks
  for (const [name, baseGas] of Object.entries(baseline.entrypoints)) {
    const curGas = current.entrypoints[name];
    if (curGas === undefined) {
      summary.push(`${name}: missing in current report`);
      continue;
    }
    const change = pctChange(curGas, baseGas);
    summary.push(`${name}: ${baseGas} → ${curGas} (${change.toFixed(2)}%)`);
    if (change > threshold) {
      failures.push(`${name} gas grew ${change.toFixed(2)}% (threshold ${threshold}%)`);
    }
  }

  // Also report new entrypoints (not in baseline)
  for (const name of Object.keys(current.entrypoints)) {
    if (!(name in baseline.entrypoints)) {
      summary.push(`${name}: NEW (${current.entrypoints[name]})`);
    }
  }

  const summaryText = ['## Gas Regression Summary', ...summary.map((s) => `- ${s}`)].join('\n');
  fs.writeFileSync('gas-summary.md', summaryText + '\n');
  console.log(summaryText);

  if (failures.length > 0) {
    console.error('\n❌ Gas regression detected:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\n✅ No gas regressions detected.');
}

main();
