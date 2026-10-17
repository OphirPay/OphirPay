import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('High-Concurrency Payments Load Benchmark (#1404)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const scriptPath = path.join(rootDir, 'tests/load/payments-concurrency.js');
  const baselinesPath = path.join(rootDir, 'tests/load/baselines.json');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const perfDocPath = path.join(rootDir, 'docs/PERFORMANCE.md');

  it('tests/load/payments-concurrency.js exists with valid node shebang', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('script executes --help successfully with CLI options', () => {
    const output = execSync(`node "${scriptPath}" --help`, { encoding: 'utf8' });
    expect(output).toContain('OphirPay High-Concurrency Payments Load Test (Issue #1404)');
    expect(output).toContain('--json');
    expect(output).toContain('LOAD_TEST_CONCURRENCY');
  });

  it('verifies 70/20/10 traffic mix logic in script content', () => {
    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('70% status & history queries');
    expect(content).toContain('20% payment creations');
    expect(content).toContain('10% webhook & audit polling');
    expect(content).toContain('statusQueriesPct: 70');
    expect(content).toContain('paymentCreationsPct: 20');
    expect(content).toContain('webhookPollingPct: 10');
  });

  it('tests/load/baselines.json defines /api/payments-concurrency with p95 <= 350', () => {
    expect(fs.existsSync(baselinesPath)).toBe(true);
    const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf8'));
    expect(baselines.endpoints).toBeDefined();
    expect(baselines.endpoints['/api/payments-concurrency']).toBeDefined();

    const entry = baselines.endpoints['/api/payments-concurrency'];
    expect(entry.p95Ms).toBeLessThanOrEqual(350);
    expect(entry.p99Ms).toBeDefined();
    expect(entry.errorPct).toBe(1);
    expect(entry.non2xxPct).toBe(1);
  });

  it('package.json registers test:load:concurrency scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(pkg.scripts['test:load:concurrency']).toBe('node tests/load/payments-concurrency.js');
    expect(pkg.scripts['test:load:concurrency:json']).toBe('node tests/load/payments-concurrency.js --json');
  });

  it('docs/PERFORMANCE.md documents concurrency benchmark usage and SLA', () => {
    const content = fs.readFileSync(perfDocPath, 'utf8');
    expect(content).toContain('## High-Concurrency Payments Load Benchmark (Issue #1404)');
    expect(content).toContain('tests/load/payments-concurrency.js');
    expect(content).toContain('70% Status & History Queries');
    expect(content).toContain('20% Payment Ingestion & Submissions');
    expect(content).toContain('10% Webhook & Audit Polling');
    expect(content).toContain('p95 Latency');
    expect(content).toContain('npm run test:load:concurrency');
  });
});
