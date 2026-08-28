import { describe, expect, it } from "vitest";

/**
 * Pure mathematical model of OphirPay Soroban multisig quorum and threshold logic.
 */
export interface MultisigConfig {
  threshold: number;
  signers: string[];
}

export interface MultisigProposal {
  id: string;
  approvals: string[];
}

export interface QuorumEvaluation {
  uniqueSignerApprovals: string[];
  approvedCount: number;
  threshold: number;
  hasQuorum: boolean;
  remainingNeeded: number;
}

/**
 * Validate configuration bounds and duplicate signer invariants.
 */
export function validateMultisigConfig(config: MultisigConfig): { valid: boolean; error?: string } {
  if (config.threshold === 0) {
    return { valid: false, error: "Threshold cannot be 0." };
  }
  const uniqueSigners = new Set(config.signers);
  if (uniqueSigners.size < config.signers.length) {
    return { valid: false, error: "Duplicate signers detected in configuration." };
  }
  if (config.threshold > uniqueSigners.size) {
    return {
      valid: false,
      error: `Threshold (${config.threshold}) exceeds unique signer count (${uniqueSigners.size}).`,
    };
  }
  return { valid: true };
}

export function evaluateMultisigQuorum(
  config: MultisigConfig,
  proposal: MultisigProposal,
): QuorumEvaluation {
  const signerSet = new Set(config.signers);
  const uniqueApprovals = new Set<string>();

  for (const approver of proposal.approvals) {
    if (signerSet.has(approver)) {
      uniqueApprovals.add(approver);
    }
  }

  const approvedCount = uniqueApprovals.size;
  const hasQuorum = approvedCount >= config.threshold;
  const remainingNeeded = Math.max(0, config.threshold - approvedCount);

  return {
    uniqueSignerApprovals: Array.from(uniqueApprovals),
    approvedCount,
    threshold: config.threshold,
    hasQuorum,
    remainingNeeded,
  };
}

describe("Multisig Threshold Property Tests (#387)", () => {
  it("rejects invalid configurations with duplicate signers or unattainable thresholds", () => {
    // 0 threshold
    expect(validateMultisigConfig({ threshold: 0, signers: ["G_A"] }).valid).toBe(false);

    // Duplicate signers in configuration array
    const dupes = validateMultisigConfig({
      threshold: 2,
      signers: ["G_ALICE", "G_ALICE", "G_BOB"],
    });
    expect(dupes.valid).toBe(false);
    expect(dupes.error).toContain("Duplicate signers detected");

    // Threshold > unique signers
    const impossible = validateMultisigConfig({
      threshold: 3,
      signers: ["G_ALICE", "G_BOB"],
    });
    expect(impossible.valid).toBe(false);
    expect(impossible.error).toContain("exceeds unique signer count");
  });

  it("never executes when approval count is below threshold (Zero False Positives)", () => {
    const config: MultisigConfig = {
      threshold: 3,
      signers: ["G_SIGNER_1", "G_SIGNER_2", "G_SIGNER_3", "G_SIGNER_4", "G_SIGNER_5"],
    };

    // 0 approvals
    expect(evaluateMultisigQuorum(config, { id: "prop_1", approvals: [] }).hasQuorum).toBe(false);

    // 1 approval
    expect(
      evaluateMultisigQuorum(config, { id: "prop_1", approvals: ["G_SIGNER_1"] }).hasQuorum,
    ).toBe(false);

    // 2 approvals (< threshold 3)
    const result = evaluateMultisigQuorum(config, {
      id: "prop_1",
      approvals: ["G_SIGNER_1", "G_SIGNER_2"],
    });
    expect(result.hasQuorum).toBe(false);
    expect(result.approvedCount).toBe(2);
    expect(result.remainingNeeded).toBe(1);
  });

  it("strictly deduplicates duplicate approvals from the same signer", () => {
    const config: MultisigConfig = {
      threshold: 3,
      signers: ["G_SIGNER_1", "G_SIGNER_2", "G_SIGNER_3"],
    };

    // Same signer approving 10 times must only count as 1
    const spamApprovals = Array(10).fill("G_SIGNER_1");
    const result = evaluateMultisigQuorum(config, { id: "prop_2", approvals: spamApprovals });

    expect(result.approvedCount).toBe(1);
    expect(result.hasQuorum).toBe(false);
    expect(result.remainingNeeded).toBe(2);
    expect(result.uniqueSignerApprovals).toEqual(["G_SIGNER_1"]);
  });

  it("completely ignores approvals from non-signer / unauthorized accounts", () => {
    const config: MultisigConfig = {
      threshold: 2,
      signers: ["G_SIGNER_1", "G_SIGNER_2"],
    };

    const adversaryApprovals = [
      "G_ATTACKER_A",
      "G_ATTACKER_B",
      "G_ATTACKER_C",
      "G_SIGNER_1", // Only 1 legitimate signer
    ];

    const result = evaluateMultisigQuorum(config, { id: "prop_3", approvals: adversaryApprovals });
    expect(result.approvedCount).toBe(1);
    expect(result.hasQuorum).toBe(false);
    expect(result.uniqueSignerApprovals).toEqual(["G_SIGNER_1"]);
  });

  it("executes exactly when threshold is reached or exceeded", () => {
    const config: MultisigConfig = {
      threshold: 2,
      signers: ["G_SIGNER_1", "G_SIGNER_2", "G_SIGNER_3"],
    };

    // Exact quorum (2 of 3)
    const exact = evaluateMultisigQuorum(config, {
      id: "prop_4",
      approvals: ["G_SIGNER_1", "G_SIGNER_2"],
    });
    expect(exact.hasQuorum).toBe(true);
    expect(exact.remainingNeeded).toBe(0);

    // Supermajority (3 of 3)
    const supermajority = evaluateMultisigQuorum(config, {
      id: "prop_4",
      approvals: ["G_SIGNER_1", "G_SIGNER_2", "G_SIGNER_3"],
    });
    expect(supermajority.hasQuorum).toBe(true);
    expect(supermajority.remainingNeeded).toBe(0);
    expect(supermajority.approvedCount).toBe(3);
  });

  it("property fuzz test: handles 200 randomized N-of-M configurations and approval permutations", () => {
    for (let iteration = 0; iteration < 200; iteration++) {
      const totalSigners = Math.floor(Math.random() * 10) + 1; // 1 to 10
      const threshold = Math.floor(Math.random() * totalSigners) + 1; // 1 to totalSigners

      const signers = Array.from({ length: totalSigners }, (_, i) => `G_POOL_SIGNER_${i}`);
      const config: MultisigConfig = { threshold, signers };

      // Validate config invariant
      expect(validateMultisigConfig(config).valid).toBe(true);

      // Generate random approvals stream with potential duplicates and rogue accounts
      const poolWithIntruders = [...signers, "G_ROGUE_1", "G_ROGUE_2"];
      const approvalCount = Math.floor(Math.random() * 25);
      const approvals: string[] = [];

      for (let j = 0; j < approvalCount; j++) {
        const randomSigner =
          poolWithIntruders[Math.floor(Math.random() * poolWithIntruders.length)]!;
        approvals.push(randomSigner);
      }

      const result = evaluateMultisigQuorum(config, { id: `prop_fuzz_${iteration}`, approvals });

      // Invariant 1: Approved count must equal the intersection of unique approvals with signer set
      const expectedValidUnique = new Set(
        approvals.filter((addr) => signers.includes(addr)),
      ).size;
      expect(result.approvedCount).toBe(expectedValidUnique);

      // Invariant 2: Quorum must be true IF AND ONLY IF approvedCount >= threshold
      expect(result.hasQuorum).toBe(expectedValidUnique >= threshold);

      // Invariant 3: Remaining needed must never be negative
      expect(result.remainingNeeded).toBeGreaterThanOrEqual(0);
      expect(result.remainingNeeded).toBe(Math.max(0, threshold - expectedValidUnique));
    }
  });
});
