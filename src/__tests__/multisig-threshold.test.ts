// SPDX-License-Identifier: MIT
// Property and threshold math tests for multisig logic (Issue #387)

import { describe, it, expect } from 'vitest';
import {
  setMultisigConfigSchema,
  proposeMultisigPaymentSchema,
  approveMultisigSchema,
  executeMultisigSchema,
} from '@/lib/validation-schemas';

/**
 * Pure reference model for N-of-M multisig state machine.
 */
interface MultisigState {
  threshold: number;
  signers: Set<string>;
  enabled: boolean;
  approvals: Set<string>;
  executed: boolean;
}

function createMultisigState(threshold: number, signers: string[], enabled: boolean = true): MultisigState {
  if (threshold <= 0 || threshold > signers.length) {
    throw new Error('Invalid threshold');
  }
  return {
    threshold,
    signers: new Set(signers),
    enabled,
    approvals: new Set(),
    executed: false,
  };
}

function approveSigner(state: MultisigState, signer: string): { success: boolean; thresholdMet: boolean; error?: string } {
  if (!state.enabled) {
    return { success: false, thresholdMet: false, error: 'MULTISIG_NOT_CONFIGURED' };
  }
  if (!state.signers.has(signer)) {
    return { success: false, thresholdMet: false, error: 'NOT_A_SIGNER' };
  }
  if (state.executed) {
    return { success: false, thresholdMet: false, error: 'ALREADY_EXECUTED' };
  }
  if (state.approvals.has(signer)) {
    return { success: false, thresholdMet: false, error: 'ALREADY_APPROVED' };
  }
  state.approvals.add(signer);
  const thresholdMet = state.approvals.size >= state.threshold;
  return { success: true, thresholdMet };
}

function executePayment(state: MultisigState): { success: boolean; error?: string } {
  if (!state.enabled) {
    return { success: false, error: 'MULTISIG_NOT_CONFIGURED' };
  }
  if (state.executed) {
    return { success: false, error: 'ALREADY_EXECUTED' };
  }
  if (state.approvals.size < state.threshold) {
    return { success: false, error: 'THRESHOLD_NOT_MET' };
  }
  state.executed = true;
  return { success: true };
}

describe('Multisig Threshold Validation Schemas', () => {
  it('validates correct N-of-M configurations', () => {
    const validConfigs = [
      { threshold: 1, signers: ['G_SIGNER_1'], enabled: true },
      { threshold: 2, signers: ['G_SIGNER_1', 'G_SIGNER_2', 'G_SIGNER_3'], enabled: true },
      { threshold: 5, signers: Array.from({ length: 5 }, (_, i) => `G_SIGNER_${i}`), enabled: false },
    ];

    for (const cfg of validConfigs) {
      const parsed = setMultisigConfigSchema.safeParse(cfg);
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects invalid threshold configs (0 or negative or empty signers)', () => {
    const invalidConfigs = [
      { threshold: 0, signers: ['G_SIGNER_1'], enabled: true },
      { threshold: -1, signers: ['G_SIGNER_1'], enabled: true },
      { threshold: 1.5, signers: ['G_SIGNER_1'], enabled: true },
      { threshold: 1, signers: [], enabled: true },
    ];

    for (const cfg of invalidConfigs) {
      const parsed = setMultisigConfigSchema.safeParse(cfg);
      expect(parsed.success).toBe(false);
    }
  });

  it('validates propose, approve, and execute schemas', () => {
    expect(proposeMultisigPaymentSchema.safeParse({ payee: 'G_PAYEE', amount: 100 }).success).toBe(true);
    expect(proposeMultisigPaymentSchema.safeParse({ payee: '', amount: 100 }).success).toBe(false);
    expect(proposeMultisigPaymentSchema.safeParse({ payee: 'G_PAYEE', amount: -5 }).success).toBe(false);

    expect(approveMultisigSchema.safeParse({ requestId: 1 }).success).toBe(true);
    expect(approveMultisigSchema.safeParse({ requestId: 0 }).success).toBe(false);
    expect(approveMultisigSchema.safeParse({ requestId: -1 }).success).toBe(false);

    expect(executeMultisigSchema.safeParse({ requestId: 42 }).success).toBe(true);
    expect(executeMultisigSchema.safeParse({ requestId: 0 }).success).toBe(false);
  });
});

describe('Multisig Threshold Math & Quorum Properties', () => {
  it('exercises random N-of-M configurations and enforces strict quorum thresholds', () => {
    // Generative pseudo-random configurations
    for (let m = 1; m <= 10; m++) {
      for (let n = 1; n <= m; n++) {
        const signers = Array.from({ length: m }, (_, i) => `SIGNER_${i}`);
        const state = createMultisigState(n, signers, true);

        // Pre-execution check with 0 approvals
        const initialExec = executePayment(state);
        expect(initialExec.success).toBe(false);
        expect(initialExec.error).toBe('THRESHOLD_NOT_MET');

        // Apply approvals one by one
        for (let k = 0; k < m; k++) {
          const signer = signers[k];
          const approvalResult = approveSigner(state, signer);

          expect(approvalResult.success).toBe(true);
          const currentCount = k + 1;

          if (currentCount < n) {
            // Below threshold
            expect(approvalResult.thresholdMet).toBe(false);
            const execAttempt = executePayment(state);
            expect(execAttempt.success).toBe(false);
            expect(execAttempt.error).toBe('THRESHOLD_NOT_MET');
          } else if (currentCount === n) {
            // Exact threshold reached
            expect(approvalResult.thresholdMet).toBe(true);
            expect(state.executed).toBe(false);
            const execAttempt = executePayment(state);
            expect(execAttempt.success).toBe(true);
            expect(state.executed).toBe(true);

            // Re-execution rejected
            const doubleExec = executePayment(state);
            expect(doubleExec.success).toBe(false);
            expect(doubleExec.error).toBe('ALREADY_EXECUTED');
            break;
          }
        }
      }
    }
  });

  it('strictly prevents duplicate approvals from double-counting or prematurely reaching threshold', () => {
    for (let m = 2; m <= 6; m++) {
      for (let n = 2; n <= m; n++) {
        const signers = Array.from({ length: m }, (_, i) => `SIGNER_${i}`);
        const state = createMultisigState(n, signers, true);

        // First signer approves
        const firstApprove = approveSigner(state, signers[0]);
        expect(firstApprove.success).toBe(true);
        expect(firstApprove.thresholdMet).toBe(false);
        expect(state.approvals.size).toBe(1);

        // Signer 0 tries to approve 10 times in a row
        for (let attempt = 0; attempt < 10; attempt++) {
          const dupApprove = approveSigner(state, signers[0]);
          expect(dupApprove.success).toBe(false);
          expect(dupApprove.error).toBe('ALREADY_APPROVED');
          expect(state.approvals.size).toBe(1); // Size unchanged

          // Execution MUST still fail
          const execAttempt = executePayment(state);
          expect(execAttempt.success).toBe(false);
          expect(execAttempt.error).toBe('THRESHOLD_NOT_MET');
        }
      }
    }
  });

  it('rejects unauthorized stranger addresses without affecting approval count', () => {
    const signers = ['SIGNER_A', 'SIGNER_B', 'SIGNER_C'];
    const state = createMultisigState(2, signers, true);

    const strangers = ['STRANGER_1', 'STRANGER_2', 'STRANGER_3', 'ATTACKER_0'];
    for (const stranger of strangers) {
      const res = approveSigner(state, stranger);
      expect(res.success).toBe(false);
      expect(res.error).toBe('NOT_A_SIGNER');
      expect(state.approvals.size).toBe(0);
    }

    const exec = executePayment(state);
    expect(exec.success).toBe(false);
    expect(exec.error).toBe('THRESHOLD_NOT_MET');
  });

  it('handles 1-of-1, 1-of-M, and M-of-M edge cases', () => {
    // 1-of-1
    const state1of1 = createMultisigState(1, ['SOLE_OWNER']);
    expect(executePayment(state1of1).error).toBe('THRESHOLD_NOT_MET');
    expect(approveSigner(state1of1, 'SOLE_OWNER').thresholdMet).toBe(true);
    expect(executePayment(state1of1).success).toBe(true);

    // 1-of-5 (any single signer triggers quorum)
    for (let i = 0; i < 5; i++) {
      const signers = Array.from({ length: 5 }, (_, idx) => `SIGNER_${idx}`);
      const state1of5 = createMultisigState(1, signers);
      const res = approveSigner(state1of5, signers[i]);
      expect(res.thresholdMet).toBe(true);
      expect(executePayment(state1of5).success).toBe(true);
    }

    // 4-of-4 unanimous
    const unanimousSigners = ['S1', 'S2', 'S3', 'S4'];
    const stateUnanimous = createMultisigState(4, unanimousSigners);
    approveSigner(stateUnanimous, 'S1');
    approveSigner(stateUnanimous, 'S2');
    approveSigner(stateUnanimous, 'S3');
    expect(executePayment(stateUnanimous).error).toBe('THRESHOLD_NOT_MET');
    approveSigner(stateUnanimous, 'S4');
    expect(executePayment(stateUnanimous).success).toBe(true);
  });
});
