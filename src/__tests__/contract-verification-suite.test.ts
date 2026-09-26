import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Contract Verification Suite (#802)', () => {
  const rootDir = process.cwd();

  it('defines the verify:contracts script in package.json', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    expect(pkg.scripts).toHaveProperty('verify:contracts');
    expect(pkg.scripts['verify:contracts']).toBe('node scripts/run-contract-verification.mjs');
  });

  it('implements the real contract invariant test harness in contracts/ophirpay/tests/contract_invariants.rs', () => {
    const invariantsPath = path.join(rootDir, 'contracts/ophirpay/tests/contract_invariants.rs');
    expect(fs.existsSync(invariantsPath)).toBe(true);

    const content = fs.readFileSync(invariantsPath, 'utf8');
    expect(content).toContain('invariant_locked_balance_fund_safety_conservation');
    expect(content).toContain('invariant_refund_paths_bounded_and_authorized');
    expect(content).toContain('invariant_escrow_single_release');
    expect(content).toContain('invariant_stream_claim_bounded_by_vested_amount');
    expect(content).toContain('invariant_pause_guard_blocks_all_mutating_entrypoints');
    expect(content).toContain('invariant_governance_single_vote_per_address');
  });

  it('includes contract verification and report upload in .github/workflows/ci.yml', () => {
    const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    expect(content).toContain('node scripts/run-contract-verification.mjs');
    expect(content).toContain('formal-verification-report');
    expect(content).toContain('upload-artifact@v4');
  });

  it('documents what is proven against contract code vs modeled in docs/VERIFICATION.md', () => {
    const verifPath = path.join(rootDir, 'docs/VERIFICATION.md');
    const content = fs.readFileSync(verifPath, 'utf8');

    expect(content).toContain('LOCKED_BALANCE Fund Safety');
    expect(content).toContain('Escrow Single-Release');
    expect(content).toContain('Stream Bounded Linear Vesting');
    expect(content).toContain('Refund Path Bounds & Authorization');
    expect(content).toContain('Pause Guard Isolation');
    expect(content).toContain('tests/contract_invariants.rs');
  });

  it('updates ROADMAP.md to reflect verified contract invariants', () => {
    const roadmapPath = path.join(rootDir, 'ROADMAP.md');
    const content = fs.readFileSync(roadmapPath, 'utf8');

    expect(content).toMatch(/\[x\] Formal verification of key contract invariants/);
    expect(content).toContain('#802');
  });

  it('produces valid verification artifacts when run', () => {
    const jsonReportPath = path.join(rootDir, 'formal-verification-report.json');
    const mdReportPath = path.join(rootDir, 'formal-verification-report.md');

    const report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
    expect(report.overall_status).toBe('PASSED');
    expect(report.contract_invariants.total).toBe(6);
    expect(report.contract_invariants.passed).toBe(6);
    expect(report.reference_models.total).toBe(9);
    expect(report.reference_models.passed).toBe(9);

    const mdContent = fs.readFileSync(mdReportPath, 'utf8');
    expect(mdContent).toContain('✅ PASSED');
    expect(mdContent).toContain('INV-CONTRACT-1');
  });
});
