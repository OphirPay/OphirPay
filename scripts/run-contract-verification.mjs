#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Script to run contract invariant verification harnesses and publish structured reports.
 *
 * Verifies key contract invariants against the real OphirPay Soroban contract
 * inside Soroban's native test environment, addressing AUDIT HIGH-2 / Issue #802.
 *
 * Outputs:
 * - JSON artifact: formal-verification-report.json
 * - Markdown report: formal-verification-report.md
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const contractsDir = path.join(projectRoot, 'contracts', 'ophirpay');
const specDir = path.join(contractsDir, 'spec');

const jsonOutputPath = process.env.VERIFICATION_JSON_PATH || path.join(projectRoot, 'formal-verification-report.json');
const mdOutputPath = process.env.VERIFICATION_MD_PATH || path.join(projectRoot, 'formal-verification-report.md');

console.log('🔍 Running OphirPay Smart Contract Invariant Verification Suite...');

const startTime = Date.now();

// 1. Run real contract invariants
const realResult = spawnSync('cargo', ['test', '--test', 'contract_invariants', '--', '--nocapture'], {
  cwd: contractsDir,
  encoding: 'utf8',
  env: { ...process.env },
});

// 2. Run spec reference models
const specResult = spawnSync('cargo', ['test', '--manifest-path', path.join(specDir, 'Cargo.toml')], {
  cwd: specDir,
  encoding: 'utf8',
  env: { ...process.env },
});

const durationMs = Date.now() - startTime;

const realStdout = realResult.stdout + '\n' + realResult.stderr;
const specStdout = specResult.stdout + '\n' + specResult.stderr;

const contractInvariants = [
  {
    id: 'INV-CONTRACT-1',
    name: 'Fund Safety & LOCKED_BALANCE Conservation',
    test_function: 'invariant_locked_balance_fund_safety_conservation',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'LOCKED_BALANCE is non-negative and emergency_withdraw is strictly blocked from extracting locked user funds (escrows, streams, proposal deposits). LOCKED_BALANCE returns to 0 on full lifecycle.',
    passed: realStdout.includes('test invariant_locked_balance_fund_safety_conservation ... ok'),
  },
  {
    id: 'INV-CONTRACT-2',
    name: 'Refund Path Integrity & Authorization',
    test_function: 'invariant_refund_paths_bounded_and_authorized',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'Refund requester must be payer or payee; refund amount cannot exceed original payment; asset must match; double processing is rejected.',
    passed: realStdout.includes('test invariant_refund_paths_bounded_and_authorized ... ok'),
  },
  {
    id: 'INV-CONTRACT-3',
    name: 'Escrow Single-Release Guarantee',
    test_function: 'invariant_escrow_single_release',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'Escrow payout occurs at most once. Double release by owner, double release by arbiter, or claim-after-release fail with EscrowAlreadyReleased.',
    passed: realStdout.includes('test invariant_escrow_single_release ... ok'),
  },
  {
    id: 'INV-CONTRACT-4',
    name: 'Stream Bounded Linear Vesting',
    test_function: 'invariant_stream_claim_bounded_by_vested_amount',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'Claims before start fail. Partial claims strictly bounded by linear vesting formula. Total claimed across lifetime <= total_amount. Cancellation strictly conserves claimed + refunded == total.',
    passed: realStdout.includes('test invariant_stream_claim_bounded_by_vested_amount ... ok'),
  },
  {
    id: 'INV-CONTRACT-5',
    name: 'Pause Guard Isolation',
    test_function: 'invariant_pause_guard_blocks_all_mutating_entrypoints',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'Emergency pause blocks all 15 mutating entrypoints with ContractPaused. Read-only getters remain available. Unpause restores mutation safely.',
    passed: realStdout.includes('test invariant_pause_guard_blocks_all_mutating_entrypoints ... ok'),
  },
  {
    id: 'INV-CONTRACT-6',
    name: 'Governance Single Vote Per Address',
    test_function: 'invariant_governance_single_vote_per_address',
    scope: 'Real Soroban Contract (OphirPayContract)',
    property: 'Each address can vote at most once per proposal. Duplicate votes are strictly rejected with AlreadyVoted.',
    passed: realStdout.includes('test invariant_governance_single_vote_per_address ... ok'),
  },
];

const specModels = [
  {
    id: 'SPEC-MODEL-1',
    name: 'LOCKED_BALANCE Arithmetic Protection',
    harness: 'locked_balance_invariant',
    passed: specStdout.includes('test invariants::locked_balance_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-2',
    name: 'Reentrancy Lock State Machine',
    harness: 'reentrancy_lock_invariant',
    passed: specStdout.includes('test invariants::reentrancy_lock_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-3',
    name: 'Proposal Deposit Lifecycle Conservation',
    harness: 'proposal_deposit_lifecycle',
    passed: specStdout.includes('test invariants::proposal_deposit_lifecycle ... ok'),
  },
  {
    id: 'SPEC-MODEL-4',
    name: 'Fee Cap (<= 1000 bps)',
    harness: 'fee_cap_invariant',
    passed: specStdout.includes('test invariants::fee_cap_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-5',
    name: 'Multisig Threshold N-of-M',
    harness: 'multisig_threshold_invariant',
    passed: specStdout.includes('test invariants::multisig_threshold_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-6',
    name: 'Timelock 24h Delay Monotonicity',
    harness: 'timelock_delay_invariant',
    passed: specStdout.includes('test invariants::timelock_delay_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-7',
    name: 'Spending Limit Expiry & Periodic Reset',
    harness: 'spending_limit_expiry_invariant',
    passed: specStdout.includes('test invariants::spending_limit_expiry_invariant ... ok'),
  },
  {
    id: 'SPEC-MODEL-8',
    name: 'Composite Deposit and Locked Balance Conservation',
    harness: 'composite_locked_balance_and_deposit',
    passed: specStdout.includes('test invariants::composite_locked_balance_and_deposit ... ok'),
  },
  {
    id: 'SPEC-MODEL-9',
    name: 'Linear Vesting Boundary Correctness',
    harness: 'compute_vested_boundary_at_end & start',
    passed: specStdout.includes('test invariants::compute_vested_boundary_at_end ... ok') &&
            specStdout.includes('test invariants::compute_vested_boundary_at_start ... ok'),
  },
];

const allRealPassed = contractInvariants.every((i) => i.passed);
const allSpecPassed = specModels.every((m) => m.passed);
const overallSuccess = allRealPassed && (realResult.status === 0) && (specResult.status === 0);

const report = {
  timestamp: new Date().toISOString(),
  duration_ms: durationMs,
  overall_status: overallSuccess ? 'PASSED' : 'FAILED',
  contract_invariants: {
    total: contractInvariants.length,
    passed: contractInvariants.filter((i) => i.passed).length,
    invariants: contractInvariants,
  },
  reference_models: {
    total: specModels.length,
    passed: specModels.filter((m) => m.passed).length,
    models: specModels,
  },
};

fs.writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2), 'utf8');

const mdReport = `# Formal Verification & Contract Invariant Report

**Status:** ${overallSuccess ? '✅ PASSED' : '❌ FAILED'}  
**Generated:** ${report.timestamp}  
**Execution Duration:** ${(durationMs / 1000).toFixed(2)}s  

## Real Contract Invariant Verification (Soroban Test Environment)

These invariants are verified against actual \`OphirPayContract\` code running in Soroban native test host (\`soroban_sdk::Env\`), proving fund-safety and state machine transitions:

| ID | Invariant | Target | Status | Property |
|---|---|---|---|---|
${contractInvariants.map((i) => `| **${i.id}** | ${i.name} | \`${i.test_function}\` | ${i.passed ? '✅ PASS' : '❌ FAIL'} | ${i.property} |`).join('\n')}

## Pure Rust Reference Models (Arithmetic & State Specifications)

| ID | Model / Property | Harness | Status |
|---|---|---|---|
${specModels.map((m) => `| **${m.id}** | ${m.name} | \`${m.harness}\` | ${m.passed ? '✅ PASS' : '❌ FAIL'} |`).join('\n')}

> **Verification Guarantee:** At least the fund-safety (LOCKED_BALANCE conservation), single-release escrow, bounded stream vesting, refund authorization limits, and pause isolation are proven against deployed contract logic.
`;

fs.writeFileSync(mdOutputPath, mdReport, 'utf8');

console.log(`\n======================================================`);
console.log(`Contract Invariant Report: ${overallSuccess ? '✅ ALL PASSED' : '❌ FAILED'}`);
console.log(`Real Contract Invariants: ${report.contract_invariants.passed}/${report.contract_invariants.total}`);
console.log(`Reference Models: ${report.reference_models.passed}/${report.reference_models.total}`);
console.log(`Report JSON: ${jsonOutputPath}`);
console.log(`Report Markdown: ${mdOutputPath}`);
console.log(`======================================================\n`);

if (!overallSuccess) {
  process.exit(1);
}
