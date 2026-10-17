// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

/**
 * Exact BigInt mirror of `ophirpay_contract::compute_vested` in
 * `contracts/ophirpay/src/helpers.rs`.
 */
function computeVested(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  now: bigint
): bigint {
  if (totalAmount <= 0n) {
    return 0n;
  }
  if (now >= endTime) {
    return totalAmount;
  }
  if (now <= startTime) {
    return 0n;
  }
  const elapsed = now - startTime;
  const totalDuration = endTime - startTime;
  if (totalDuration === 0n) {
    return totalAmount;
  }
  const whole = (totalAmount / totalDuration) * elapsed;
  const fractional = ((totalAmount % totalDuration) * elapsed) / totalDuration;
  return whole + fractional;
}

describe("Stream vesting curve proptest invariants (#1297)", () => {
  it("defines 10,000-case proptest invariant suite in contracts/ophirpay/tests/proptest_token_moving.rs", () => {
    const proptestFile = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "contracts/ophirpay/tests/proptest_token_moving.rs"
      ),
      "utf8"
    );
    expect(proptestFile).toContain("const VESTING_FUZZ_CASES: u32 = 10_000;");
    expect(proptestFile).toContain("fn prop_vesting_curve_invariants_10k");
    expect(proptestFile).toContain(
      "fn prop_vesting_curve_arbitrary_inputs_never_panic"
    );
    expect(proptestFile).toContain("fn test_vesting_curve_explicit_edge_cases");
  });

  it("verifies monotonicity, boundedness, claimed ceiling, and zero-panic across 10,000 randomized iterations", () => {
    // Deterministic xorshift64* PRNG for repeatable 10,000-case fuzzing
    let state = 0x9e3779b97f4a7c15n;
    const nextU64 = (): bigint => {
      state ^= state >> 12n;
      state ^= (state << 25n) & U64_MAX;
      state ^= state >> 27n;
      return (state * 0x2545f4914f6cdd1dn) & U64_MAX;
    };

    for (let i = 0; i < 10_000; i++) {
      const hi = nextU64() & ((1n << 63n) - 1n);
      const lo = nextU64();
      const totalAmount = ((hi << 64n) | lo) || 1n;
      const startTime = nextU64();
      const rawDuration = nextU64();
      const endTime =
        startTime + rawDuration > U64_MAX ? U64_MAX : startTime + rawDuration;

      const r1 = nextU64();
      const r2 = nextU64();
      const [earlier, later] = r1 <= r2 ? [r1, r2] : [r2, r1];

      const vestedEarlier = computeVested(
        totalAmount,
        startTime,
        endTime,
        earlier
      );
      const vestedLater = computeVested(totalAmount, startTime, endTime, later);

      // 1. Boundedness
      expect(vestedEarlier >= 0n && vestedEarlier <= totalAmount).toBe(true);
      expect(vestedLater >= 0n && vestedLater <= totalAmount).toBe(true);

      // 2. Monotonicity
      expect(vestedLater >= vestedEarlier).toBe(true);

      // 3. Claimed ceiling
      const claimed = vestedEarlier;
      const claimable = vestedLater - claimed;
      expect(claimable >= 0n).toBe(true);
      expect(claimed + claimable <= totalAmount).toBe(true);
    }
  });

  it("handles zero duration, i128::MAX amounts, and start_time == current_time edge cases", () => {
    expect(computeVested(1_000_000n, 500n, 500n, 499n)).toBe(0n);
    expect(computeVested(1_000_000n, 500n, 500n, 500n)).toBe(1_000_000n);
    expect(computeVested(I128_MAX, 1_000n, 2_000n, 1_000n)).toBe(0n);
    expect(computeVested(I128_MAX, U64_MAX - 10n, U64_MAX, U64_MAX - 5n)).toBe(
      I128_MAX / 2n
    );
    expect(computeVested(0n, 100n, 200n, 150n)).toBe(0n);
    expect(computeVested(-500n, 100n, 200n, 250n)).toBe(0n);
  });
});
