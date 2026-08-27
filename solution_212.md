# Solution for #212: Contract gas-diff regression test (WASM size / fee assertions)

// File: .github/workflows/gas-regression.yml
name: Gas Regression Check

on:
  pull_request:
    paths:
      - 'contracts/**'
      - 'scripts/**'
  push:
    branches: [main]

jobs:
  check-gas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci
      - name: Record baseline (if missing)
        run: npm run gas:record -- --if-missing
      - name: Run gas regression check
        run: npm run gas:check
      - name: Report to job summary
        if: always()
        run: |
          if [ -f gas-summary.md ]; then
            cat gas-summary.md >> $GITHUB_STEP_SUMMARY
          fi

// File: package.json (partial – add scripts)
{
  "scripts": {
    "build": "hardhat compile",
    "test:gas": "hardhat test --gas-report",
    "gas:record": "ts-node scripts/check-gas-regression.ts --record",
    "gas:check": "ts-node scripts/check-gas-regression.ts --check"
  },
  "devDependencies": {
    "@types/node": "^18",
    "hardhat": "^2.19",
    "ts-node": "^10.9",
    "typescript": "^5.0"
  }
}

// File: contracts/gas-baseline.json
{
  "version": "1",
  "thresholdPercent": 5,
  "wasmSize": 12345,
  "entrypoints": {
    "transfer": 150000,
    "withdraw": 200000,
    "deposit": 180000
  }
}

// File: scripts/check-gas-regression.ts
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

function loadBaseline(): Baseline | null {
  if (fs.existsSync(BASELINE_FILE)) {
    const content = fs.readFileSync(BASELINE_FILE, 'utf-8');
    return JSON.parse(content);
  }
  return null;
}

function saveBaseline(data: CurrentData): void {
  const baseline: Baseline = {
    version: '1',
    thresholdPercent: THRESHOLD_PERCENT,
    wasmSize: data.wasmSize,
    entrypoints: data.entrypoints,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(`Baseline saved to ${BASELINE_FILE}`);
}

function compare(baseline: Baseline, current: CurrentData): { ok: boolean; details: string[] } {
  const threshold = baseline.thresholdPercent ?? THRESHOLD_PERCENT;
  const details: string[] = [];
  let ok = true;

  // Compare size
  const sizeDiff = ((current.wasmSize - baseline.wasmSize) / baseline.wasmSize) * 100;
  if (sizeDiff > threshold) {
    ok = false;
    details.push(`WASM size increased by ${sizeDiff.toFixed(2)}% (${current.wasmSize} vs ${baseline.wasmSize})`);
  } else {
    details.push(`WASM size change: ${sizeDiff.toFixed(2)}% (${current.wasmSize} vs ${baseline.wasmSize})`);
  }

  // Compare entrypoints
  const allKeys = new Set([...Object.keys(baseline.entrypoints), ...Object.keys(current.entrypoints)]);
  for (const key of allKeys) {
    const base = baseline.entrypoints[key];
    const curr = current.entrypoints[key];
    if (base === undefined) {
      details.push(`New entrypoint "${key}" detected: ${curr} gas (no baseline)`);
      // Optionally treat as warning, but allow
    } else if (curr === undefined) {
      details.push(`Entrypoint "${key}" missing from current report`);
      ok = false; // missing entrypoint is a regression
    } else {
      const diff = ((curr - base) / base) * 100;
      if (diff > threshold) {
        ok = false;
        details.push(`Entrypoint "${key}" gas increased by ${diff.toFixed(2)}% (${curr} vs ${base})`);
      } else {
        details.push(`Entrypoint "${key}" gas change: ${diff.toFixed(2)}% (${curr} vs ${base})`);
      }
    }
  }

  return { ok, details };
}

function generateMarkdownSummary(details: string[], ok: boolean): string {
  const lines: string[] = [];
  lines.push('## Gas Regression Check Summary');
  lines.push('');
  if (ok) {
    lines.push('✅ **All checks passed** – no significant regressions detected.');
  } else {
    lines.push('❌ **Regression detected** – please review the changes.');
  }
  lines.push('');
  lines.push('### Details');
  lines.push('');
  for (const d of details) {
    lines.push(`- ${d}`);
  }
  lines.push('');
  lines.push(`Threshold: ${THRESHOLD_PERCENT}% increase allowed.`);
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const recordMode = args.includes('--record');
  const checkMode = args.includes('--check') || !recordMode;

  if (recordMode) {
    console.log('Recording current values as baseline...');
    const current = getCurrentData();
    saveBaseline(current);
    console.log('Baseline recorded.');
    process.exit(0);
  }

  if (checkMode) {
    const baseline = loadBaseline();
    if (!baseline) {
      console.error('No baseline found. Run `npm run gas:record` first.');
      process.exit(1);
    }

    console.log('Collecting current data...');
    const current = getCurrentData();
    console.log('Comparing against baseline...');
    const { ok, details } = compare(baseline, current);

    // Write details to console
    for (const line of details) {
      console.log(line);
    }

    // Generate markdown summary and write to file for CI
    const summary = generateMarkdownSummary(details, ok);
    fs.writeFileSync('gas-summary.md', summary);

    if (!ok) {
      console.error('❌ Gas regression detected. See above details.');
      process.exit(1);
    } else {
      console.log('✅ No significant regressions.');
      process.exit(0);
    }
  }
}

main();

// File: test/check-gas-regression.test.ts
import { compare, loadBaseline, saveBaseline, getCurrentData } from '../scripts/check-gas-regression'; // adjust import if using module
import fs from 'fs';
import path from 'path';

// Mock external dependencies
jest.mock('child_process');
jest.mock('fs');

const mockBaselineFile = path.join(process.cwd(), 'contracts', 'gas-baseline.json');

describe('Gas regression check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fs.existsSync to return false by default
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  test('compare returns ok when changes are within threshold', () => {
    const baseline = { version: '1', wasmSize: 1000, entrypoints: { foo: 100 } };
    const current = { wasmSize: 1020, entrypoints: { foo: 102 } };
    const result = compare(baseline, current);
    expect(result.ok).toBe(true);
    expect(result.details).toHaveLength(2);
  });

  test('compare fails when WASM size exceeds threshold', () => {
    const baseline = { version: '1', wasmSize: 1000, entrypoints: { foo: 100 } };
    const current = { wasmSize: 1100, entrypoints: { foo: 100 } };
    const result = compare(baseline, current);
    expect(result.ok).toBe(false);
    expect(result.details.some(d => d.includes('WASM size increased'))).toBe(true);
  });

  test('compare fails when entrypoint gas exceeds threshold', () => {
    const baseline = { version: '1', wasmSize: 1000, entrypoints: { foo: 100 } };
    const current = { wasmSize: 1000, entrypoints: { foo: 110 } };
    const result = compare(baseline, current);
    expect(result.ok).toBe(false);
    expect(result.details.some(d => d.includes('foo') && d.includes('increased'))).toBe(true);
  });

  test('compare fails when entrypoint missing in current', () => {
    const baseline = { version: '1', wasmSize: 1000, entrypoints: { foo: 100 } };
    const current = { wasmSize: 1000, entrypoints: {} };
    const result = compare(baseline, current);
    expect(result.ok).toBe(false);
    expect(result.details.some(d => d.includes('foo') && d.includes('missing'))).toBe(true);
  });

  test('saveBaseline writes correct JSON', () => {
    const data = { wasmSize: 2000, entrypoints: { bar: 300 } };
    saveBaseline(data);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      mockBaselineFile,
      JSON.stringify({ version: '1', thresholdPercent: 5, wasmSize: 2000, entrypoints: { bar: 300 } }, null, 2)
    );
  });

  test('loadBaseline returns null if file missing', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    expect(loadBaseline()).toBeNull();
  });

  test('loadBaseline returns parsed object if exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('{"version":"1","wasmSize":1000,"entrypoints":{"foo":100}}');
    expect(loadBaseline

---
_Generated by DevilX BountyHub solver_
