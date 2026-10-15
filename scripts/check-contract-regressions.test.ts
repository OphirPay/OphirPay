import { describe, it, expect } from 'vitest';
import {
  pct,
  signed,
  formatPct,
  compareWasmSizes,
  compareFeeReports,
  buildRegressionReport,
  PROTOCOL_LIMIT_BYTES_DEFAULT,
} from './check-contract-regressions.mjs';

describe('check-contract-regressions helpers', () => {
  it('pct computes percentage delta correctly', () => {
    expect(pct(0, 100)).toBe(0);
    expect(pct(5, 100)).toBe(5);
    expect(pct(-10, 100)).toBe(-10);
    expect(pct(0, 0)).toBe(0);
    expect(pct(10, 0)).toBe(100);
  });

  it('signed prefixes positive numbers with +', () => {
    expect(signed(10)).toBe('+10');
    expect(signed(-5)).toBe('-5');
    expect(signed(0)).toBe('0');
  });

  it('formatPct formats percentages with + sign and 2 decimals', () => {
    expect(formatPct(4.5)).toBe('+4.50%');
    expect(formatPct(-2.123)).toBe('-2.12%');
    expect(formatPct(0)).toBe('0.00%');
  });
});

describe('compareWasmSizes', () => {
  const sampleContracts = {
    ophirpay: {
      artifact: 'contracts/ophirpay/target/wasm.wasm',
      baselineBytes: 100000,
      maxBytes: 200000,
    },
    emitter: {
      artifact: 'contracts/emitter/target/wasm.wasm',
      baselineBytes: 20000,
      maxBytes: 50000,
    },
  };

  it('passes when sizes are within threshold and below protocol limit', () => {
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 102000, // +2% growth
      'contracts/emitter/target/wasm.wasm': 19000, // -5% shrinkage
    };

    const res = compareWasmSizes(sampleContracts, {
      root: '',
      thresholdPercent: 5,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.failures).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.sizeRows).toHaveLength(2);
    expect(res.sizeRows[0].delta).toBe(2000);
    expect(res.sizeRows[0].deltaPercent).toBe(2);
  });

  it('fails when growth exceeds threshold percentage (> 5%)', () => {
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 107000, // +7% growth (> 5%)
      'contracts/emitter/target/wasm.wasm': 20000,
    };

    const res = compareWasmSizes(sampleContracts, {
      root: '',
      thresholdPercent: 5,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('WASM grew +7.00%');
    expect(res.failures[0]).toContain('over the 5% threshold');
  });

  it('flags warning when WASM size exceeds 128 KB protocol limit', () => {
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 132000, // > 131,072 bytes (128 KB)
      'contracts/emitter/target/wasm.wasm': 20000,
    };

    const res = compareWasmSizes(sampleContracts, {
      root: '',
      thresholdPercent: 50,
      protocolLimitBytes: PROTOCOL_LIMIT_BYTES_DEFAULT,
      failOnProtocolLimit: false,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain('exceeds Soroban protocol limit of 128 KB (131072 bytes)');
    expect(res.failures).toEqual([]);
  });

  it('fails when failOnProtocolLimit is enabled and size exceeds 128 KB', () => {
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 132000,
      'contracts/emitter/target/wasm.wasm': 20000,
    };

    const res = compareWasmSizes(sampleContracts, {
      root: '',
      thresholdPercent: 50,
      protocolLimitBytes: PROTOCOL_LIMIT_BYTES_DEFAULT,
      failOnProtocolLimit: true,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('exceeds Soroban protocol limit');
  });

  it('fails when size exceeds maxBytes guardrail', () => {
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 250000, // > 200000 maxBytes
      'contracts/emitter/target/wasm.wasm': 20000,
    };

    const res = compareWasmSizes(sampleContracts, {
      root: '',
      thresholdPercent: 200,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('exceeds the 200000-byte guardrail');
  });

  it('updates baseline without failure when updateBaseline is true', () => {
    const contractsCopy = JSON.parse(JSON.stringify(sampleContracts));
    const mockFiles: Record<string, number> = {
      'contracts/ophirpay/target/wasm.wasm': 120000, // +20%
      'contracts/emitter/target/wasm.wasm': 20000,
    };

    const res = compareWasmSizes(contractsCopy, {
      root: '',
      thresholdPercent: 5,
      updateBaseline: true,
      readFileBytes: (p: string) => mockFiles[p.replace(/\\/g, '/')],
      existsFn: () => true,
    });

    expect(res.failures).toEqual([]);
    expect(res.baselineChanged).toBe(true);
    expect(contractsCopy.ophirpay.baselineBytes).toBe(120000);
  });

  it('handles missing artifacts cleanly in local dev mode', () => {
    const res = compareWasmSizes(sampleContracts, {
      root: '',
      isCI: false,
      allowMissing: true,
      existsFn: () => false,
    });

    expect(res.failures).toEqual([]);
    expect(res.missingArtifacts).toHaveLength(2);
    expect(res.sizeRows[0].missing).toBe(true);
  });

  it('fails on missing artifacts in CI mode', () => {
    const res = compareWasmSizes(sampleContracts, {
      root: '',
      isCI: true,
      allowMissing: false,
      existsFn: () => false,
    });

    expect(res.failures).toHaveLength(2);
    expect(res.failures[0]).toContain('Missing release artifact');
  });
});

describe('compareFeeReports', () => {
  const feeBaseline = {
    fees: [
      { amount: 10000, bps: 30, fee: 30 },
      { amount: 10000, bps: 50, fee: 50 },
    ],
  };

  it('passes when fee matches baseline exactly', () => {
    const feeReport = {
      fees: [
        { amount: 10000, bps: 30, fee: 30 },
        { amount: 10000, bps: 50, fee: 50 },
      ],
    };

    const res = compareFeeReports(feeReport, feeBaseline);
    expect(res.failures).toEqual([]);
    expect(res.feeRows).toHaveLength(2);
  });

  it('fails when fee deviates from baseline', () => {
    const feeReport = {
      fees: [
        { amount: 10000, bps: 30, fee: 35 }, // changed
        { amount: 10000, bps: 50, fee: 50 },
      ],
    };

    const res = compareFeeReports(feeReport, feeBaseline);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('calculate_fee(10000, 30 bps) changed: 30 → 35 stroops (+5)');
  });

  it('fails when fee assertion is missing from report', () => {
    const feeReport = {
      fees: [{ amount: 10000, bps: 30, fee: 30 }],
    };

    const res = compareFeeReports(feeReport, feeBaseline);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('missing from the report');
  });
});

describe('buildRegressionReport', () => {
  it('renders passing report markdown table', () => {
    const report = buildRegressionReport({
      sizeRows: [
        {
          name: 'ophirpay',
          baselineBytes: 100000,
          bytes: 101000,
          delta: 1000,
          deltaPercent: 1.0,
          maxBytes: 200000,
          missing: false,
        },
      ],
      feeRows: [{ amount: '10000', bps: '30', baseFee: 30, newFee: 30, delta: 0 }],
      failures: [],
      warnings: [],
      thresholdPercent: 5,
      protocolLimitBytes: 131072,
    });

    expect(report).toContain('## Contract regression report');
    expect(report).toContain('`ophirpay`');
    expect(report).toContain('100000');
    expect(report).toContain('101000');
    expect(report).toContain('+1000');
    expect(report).toContain('+1.00%');
    expect(report).toContain('✅ **Passed**');
  });

  it('renders failing report with listed issues', () => {
    const report = buildRegressionReport({
      sizeRows: [],
      failures: ['ophirpay: WASM grew +10.00%'],
      warnings: [],
      thresholdPercent: 5,
    });

    expect(report).toContain('❌ **Failed**');
    expect(report).toContain('- ophirpay: WASM grew +10.00%');
  });

  it('renders local dev information when artifacts are missing', () => {
    const report = buildRegressionReport({
      sizeRows: [{ name: 'ophirpay', baselineBytes: 100000, missing: true, maxBytes: 200000 }],
      missingArtifacts: [{ name: 'ophirpay', artifact: 'contracts/ophirpay.wasm' }],
      isLocalDev: true,
    });

    expect(report).toContain('*(not built)*');
    expect(report).toContain('Local development environment');
    expect(report).not.toContain('❌ **Failed**');
  });
});
