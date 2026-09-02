// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";

/**
 * Property-based tests for multisig threshold logic.
 *
 * Covers:
 *  1. Quorum checks – execution blocked below threshold, allowed at/above.
 *  2. Approval dedupe – duplicate approvals do not double-count.
 *  3. N-of-M edge cases – threshold = 1, threshold = M, threshold = 0, M = 1, etc.
 *  4. Random configurations exercised via deterministic seeded properties.
 *
 * Uses a pure-JS simulation of the on-chain multisig state-machine so
 * properties can run fast without Soroban environment setup. The behaviour
 * mirrors the Rust contract exactly:
 *   - threshold must satisfy 1 ≤ threshold ≤ signers.len()
 *   - a proposal starts with 0 approvals
 *   - each unique signer may approve once
 *   - execution succeeds iff approvals.len() ≥ threshold && !executed
 *   - duplicate approvals are rejected
 */

// ---------------------------------------------------------------------------
// Pure-JS multisig simulation (mirrors on-chain logic)
// ---------------------------------------------------------------------------

interface MultisigConfig {
  threshold: number;
  signers: string[];
  enabled: boolean;
}

interface ApprovalRequest {
  id: number;
  proposer: string;
  payee: string;
  amount: number;
  approvals: string[];
  executed: boolean;
}

interface SimState {
  config: MultisigConfig | null;
  nextRequestId: number;
  requests: Map<number, ApprovalRequest>;
  nextPaymentId: number;
}

function createState(): SimState {
  return {
    config: null,
    nextRequestId: 1,
    requests: new Map(),
    nextPaymentId: 1,
  };
}

function setConfig(
  state: SimState,
  threshold: number,
  signers: string[],
  enabled: boolean,
): void {
  if (threshold < 1 || threshold > signers.length) {
    throw new Error("InvalidAmount: threshold must be 1..signers.length");
  }
  state.config = { threshold, signers, enabled };
}

function propose(state: SimState, proposer: string, payee: string, amount: number): number {
  if (!state.config || !state.config.enabled) {
    throw new Error("MultisigNotConfigured");
  }
  const id = state.nextRequestId++;
  state.requests.set(id, {
    id,
    proposer,
    payee,
    amount,
    approvals: [],
    executed: false,
  });
  return id;
}

function approve(state: SimState, signer: string, requestId: number): boolean {
  if (!state.config) {
    throw new Error("MultisigNotConfigured");
  }
  if (!state.config.signers.includes(signer)) {
    throw new Error("NotASigner");
  }
  const req = state.requests.get(requestId);
  if (!req) throw new Error("PaymentNotFound");
  if (req.executed) throw new Error("AlreadyExecuted");
  if (req.approvals.includes(signer)) {
    throw new Error("AlreadyApproved");
  }
  req.approvals.push(signer);
  return req.approvals.length >= state.config.threshold;
}

function execute(state: SimState, _caller: string, requestId: number): number {
  if (!state.config) {
    throw new Error("MultisigNotConfigured");
  }
  const req = state.requests.get(requestId);
  if (!req) throw new Error("PaymentNotFound");
  if (req.executed) throw new Error("AlreadyExecuted");
  if (req.approvals.length < state.config.threshold) {
    throw new Error("ThresholdNotMet");
  }
  req.executed = true;
  return state.nextPaymentId++;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (xoshiro128**) – no external dependencies
// ---------------------------------------------------------------------------
class Xoshiro128 {
  private s: [number, number, number, number];

  constructor(seed: number) {
    // SplitMix32 to initialise state from a single seed
    const splitmix = (z: number) => {
      z = (z + 0x9e3779b9) | 0;
      let t = z ^ (z >>> 16);
      t = Math.imul(t, 0x85ebca6b);
      t = t ^ (t >>> 13);
      t = Math.imul(t, 0xc2b2ae35);
      return (t ^ (t >>> 16)) >>> 0;
    };
    this.s = [
      splitmix(seed),
      splitmix(seed + 1),
      splitmix(seed + 2),
      splitmix(seed + 3),
    ];
  }

  next(): number {
    const [s0, s1, s2, s3] = this.s;
    const result = ((s0 + s3) | 0) >>> 0;
    const t = (s1 << 9) | 0;
    this.s[0] = s0 ^ s3;
    this.s[1] = s1 ^ s2;
    this.s[2] = s2 ^ s0;
    this.s[3] = ((s3 ^ s1) | 0) ^ t;
    // z = s[3] is rotated left by 11 – approximation
    this.s[3] = (((s3 ^ s1) ^ t) << 11) | (((s3 ^ s1) ^ t) >>> 21);
    return result / 0x100000000; // [0, 1)
  }

  /** Return integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Return a shuffled copy of the array (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeSigners = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `signer_${i}`);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------
const ITERATIONS = 200;
const SEED = 42;
const rng = new Xoshiro128(SEED);

// ── P1: Valid threshold always in 1..M ────────────────────────────────
describe("P1 – valid threshold in 1..M", () => {
  it("accepts threshold between 1 and M inclusive for random M", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 20);
      const threshold = rng.int(1, m);
      const signers = makeSigners(m);
      const state = createState();
      expect(() => setConfig(state, threshold, signers, true)).not.toThrow();
      expect(state.config!.threshold).toBe(threshold);
      expect(state.config!.signers.length).toBe(m);
    }
  });
});

// ── P2: Invalid threshold always rejected ─────────────────────────────
describe("P2 – invalid threshold always rejected", () => {
  it("rejects threshold = 0 for any M ≥ 1", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 20);
      const signers = makeSigners(m);
      const state = createState();
      expect(() => setConfig(state, 0, signers, true)).toThrow("InvalidAmount");
    }
  });

  it("rejects threshold > M for any M", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 20);
      const threshold = m + rng.int(1, 10);
      const signers = makeSigners(m);
      const state = createState();
      expect(() => setConfig(state, threshold, signers, true)).toThrow("InvalidAmount");
    }
  });
});

// ── P3: Execution blocked below threshold ─────────────────────────────
describe("P3 – execution blocked below threshold", () => {
  it("never executes with fewer approvals than threshold", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(2, 10);
      const threshold = rng.int(2, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const proposer = signers[0]!;
      const payee = "payee_random";
      const reqId = propose(state, proposer, payee, 100);

      // Approve with (threshold - 1) unique signers
      const shuffled = rng.shuffle(signers);
      let approvalsCount = 0;
      for (const s of shuffled) {
        if (approvalsCount >= threshold - 1) break;
        approve(state, s, reqId);
        approvalsCount++;
      }

      // Should NOT be able to execute
      expect(() => execute(state, signers[0]!, reqId)).toThrow("ThresholdNotMet");
    }
  });
});

// ── P4: Execution allowed at/above threshold ──────────────────────────
describe("P4 – execution allowed at threshold", () => {
  it("executes successfully with exactly threshold approvals", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const threshold = rng.int(1, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const proposer = signers[0]!;
      const reqId = propose(state, proposer, "payee", 100);

      // Approve with exactly `threshold` unique signers
      const shuffled = rng.shuffle(signers);
      let approvalsCount = 0;
      for (const s of shuffled) {
        if (approvalsCount >= threshold) break;
        approve(state, s, reqId);
        approvalsCount++;
      }

      const payId = execute(state, signers[0]!, reqId);
      expect(payId).toBeGreaterThan(0);
    }
  });
});

// ── P5: Duplicate approvals do not double-count ───────────────────────
describe("P5 – duplicate approvals do not double-count", () => {
  it("rejects duplicate approval and does not increment count", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(2, 10);
      const threshold = rng.int(2, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const reqId = propose(state, signers[0]!, "payee", 100);

      // First approval from signers[0]
      approve(state, signers[0]!, reqId);
      const approvalsAfterFirst = state.requests.get(reqId)!.approvals.length;
      expect(approvalsAfterFirst).toBe(1);

      // Duplicate approval from same signer
      expect(() => approve(state, signers[0]!, reqId)).toThrow("AlreadyApproved");

      // Approval count must remain 1
      const approvalsAfterDup = state.requests.get(reqId)!.approvals.length;
      expect(approvalsAfterDup).toBe(1);
    }
  });

  it("duplicate approval does not trigger execution even if it would meet threshold", () => {
    // threshold=2, signer_0 approves, then tries to approve again
    const state = createState();
    setConfig(state, 2, makeSigners(3), true);
    const reqId = propose(state, "signer_0", "payee", 100);

    approve(state, "signer_0", reqId);
    expect(state.requests.get(reqId)!.approvals.length).toBe(1);

    expect(() => approve(state, "signer_0", reqId)).toThrow("AlreadyApproved");
    // Still only 1 approval — execution must be blocked
    expect(() => execute(state, "signer_0", reqId)).toThrow("ThresholdNotMet");
  });
});

// ── P6: Non-signer approval always rejected ───────────────────────────
describe("P6 – non-signer approval always rejected", () => {
  it("rejects approvals from addresses not in the signer set", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const threshold = rng.int(1, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const reqId = propose(state, signers[0]!, "payee", 100);
      const outsider = "random_outsider_" + i;
      expect(() => approve(state, outsider, reqId)).toThrow("NotASigner");
    }
  });
});

// ── P7: Cannot execute twice ──────────────────────────────────────────
describe("P7 – cannot execute twice", () => {
  it("rejects second execution of the same proposal", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const threshold = rng.int(1, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const reqId = propose(state, signers[0]!, "payee", 100);

      const shuffled = rng.shuffle(signers);
      let approvalsCount = 0;
      for (const s of shuffled) {
        if (approvalsCount >= threshold) break;
        approve(state, s, reqId);
        approvalsCount++;
      }

      execute(state, signers[0]!, reqId);
      expect(state.requests.get(reqId)!.executed).toBe(true);

      // Second execution must fail
      expect(() => execute(state, signers[0]!, reqId)).toThrow("AlreadyExecuted");
    }
  });
});

// ── P8: Cannot approve after execution ────────────────────────────────
describe("P8 – cannot approve after execution", () => {
  it("rejects approval on an already-executed request", () => {
    const state = createState();
    setConfig(state, 1, ["signer_A", "signer_B"], true);

    const reqId = propose(state, "signer_A", "payee", 500);

    approve(state, "signer_A", reqId);
    execute(state, "signer_A", reqId);

    expect(() => approve(state, "signer_B", reqId)).toThrow("AlreadyExecuted");
  });
});

// ── P9: Threshold = 1 means single approval suffices ─────────────────
describe("P9 – threshold = 1 (single approval suffices)", () => {
  it("executes after exactly one approval when threshold = 1", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const state = createState();
      setConfig(state, 1, makeSigners(m), true);

      const reqId = propose(state, "signer_0", "payee", 42);
      const result = approve(state, "signer_0", reqId);
      expect(result).toBe(true); // threshold met

      const payId = execute(state, "signer_0", reqId);
      expect(payId).toBeGreaterThan(0);
    }
  });
});

// ── P10: Threshold = M means all signers must approve ─────────────────
describe("P10 – threshold = M (unanimous required)", () => {
  it("executes only when all M signers approve", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, m, signers, true); // threshold = M

      const reqId = propose(state, signers[0]!, "payee", 999);

      // Approve with all but one
      const shuffled = rng.shuffle(signers);
      let lastThresholdMet = false;
      for (let j = 0; j < shuffled.length; j++) {
        const met = approve(state, shuffled[j]!, reqId);
        if (j < m - 1) {
          expect(met).toBe(false); // not yet unanimous
          expect(() => execute(state, "signer_0", reqId)).toThrow("ThresholdNotMet");
        } else {
          lastThresholdMet = met;
        }
      }

      expect(lastThresholdMet).toBe(true);
      const payId = execute(state, "signer_0", reqId);
      expect(payId).toBeGreaterThan(0);
    }
  });
});

// ── P11: Different requests are independent ───────────────────────────
describe("P11 – different requests are independent", () => {
  it("executing one request does not affect another", () => {
    const state = createState();
    setConfig(state, 2, makeSigners(3), true);

    const req1 = propose(state, "signer_0", "payee_A", 100);
    const req2 = propose(state, "signer_0", "payee_B", 200);

    approve(state, "signer_0", req1);
    approve(state, "signer_1", req1);
    execute(state, "signer_0", req1);

    // req2 still has 0 approvals
    expect(state.requests.get(req2)!.approvals.length).toBe(0);
    expect(() => execute(state, "signer_0", req2)).toThrow("ThresholdNotMet");
  });
});

// ── P12: Config overwrite replaces old config ─────────────────────────
describe("P12 – config overwrite replaces old config", () => {
  it("changing threshold takes effect for subsequent proposals", () => {
    const state = createState();
    setConfig(state, 3, makeSigners(4), true);

    // Overwrite with threshold = 1
    setConfig(state, 1, makeSigners(1), true);
    expect(state.config!.threshold).toBe(1);
    expect(state.config!.signers.length).toBe(1);

    const reqId = propose(state, "signer_0", "payee", 50);
    const met = approve(state, "signer_0", reqId);
    expect(met).toBe(true);

    execute(state, "signer_0", reqId);
  });
});

// ── P13: No proposals possible when disabled ──────────────────────────
describe("P13 – no proposals possible when disabled", () => {
  it("rejects proposals when multisig is not enabled", () => {
    const state = createState();
    setConfig(state, 2, makeSigners(3), false);

    expect(() => propose(state, "signer_0", "payee", 100)).toThrow("MultisigNotConfigured");
  });
});

// ── P14: Propose before config always rejected ────────────────────────
describe("P14 – propose before config always rejected", () => {
  it("rejects proposals when no config exists", () => {
    const state = createState();
    expect(() => propose(state, "anyone", "payee", 100)).toThrow("MultisigNotConfigured");
  });
});

// ── P15: Total approval count never exceeds unique signers ────────────
describe("P15 – approval count bounded by unique signers", () => {
  it("approval list length ≤ number of unique signers who approved", () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const m = rng.int(1, 10);
      const threshold = rng.int(1, m);
      const signers = makeSigners(m);
      const state = createState();
      setConfig(state, threshold, signers, true);

      const reqId = propose(state, "signer_0", "payee", 100);

      const shuffled = rng.shuffle(signers);
      const uniqueApprovals: string[] = [];
      for (const s of shuffled) {
        try {
          approve(state, s, reqId);
          uniqueApprovals.push(s);
        } catch {
          // duplicates/outside are rejected
        }
      }

      // Approvals in the request must exactly match uniqueApprovals
      expect(state.requests.get(reqId)!.approvals.length).toBe(uniqueApprovals.length);
      expect(state.requests.get(reqId)!.approvals.length).toBeLessThanOrEqual(m);
    }
  });
});
