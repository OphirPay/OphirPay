import { describe, it, expect } from "vitest";

/**
 * Mirror of contract stream vesting math for pro-rata cancellation splits (#1357).
 */
export function computeVestedAmount(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  now: bigint
): bigint {
  if (now >= endTime) return totalAmount;
  if (now <= startTime) return BigInt(0);

  const duration = endTime - startTime;
  if (duration === BigInt(0)) return totalAmount;

  const elapsed = now - startTime;
  return (totalAmount * elapsed) / duration;
}

/**
 * Computes the pro-rata split upon cancelling a stream (#1357).
 * Returns: { claimed, earnedUnclaimed, unvestedRefundable, totalConserved: boolean }
 */
export function calculateStreamCancelSplit(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  now: bigint,
  claimedSoFar: bigint = BigInt(0)
) {
  const vested = computeVestedAmount(totalAmount, startTime, endTime, now);
  if (claimedSoFar > vested) {
    throw new Error("StreamInvariantViolated: claimed cannot exceed vested");
  }
  const earnedUnclaimed = vested - claimedSoFar;
  const unvestedRefundable = totalAmount - vested;
  const isConserved = claimedSoFar + earnedUnclaimed + unvestedRefundable === totalAmount;

  return {
    vested,
    claimed: claimedSoFar,
    earnedUnclaimed,
    unvestedRefundable,
    isConserved,
  };
}

describe("Stream Cancellation Pro-Rata Refund Verification (#1357)", () => {
  const startTime = BigInt(10_000);
  const duration = BigInt(1_000);
  const endTime = startTime + duration;
  const totalAmount = BigInt(10_000);

  it("verifies cancellation at 0% elapsed time (full refund to creator)", () => {
    const split = calculateStreamCancelSplit(totalAmount, startTime, endTime, startTime, BigInt(0));
    expect(split.vested).toBe(BigInt(0));
    expect(split.earnedUnclaimed).toBe(BigInt(0));
    expect(split.unvestedRefundable).toBe(totalAmount);
    expect(split.isConserved).toBe(true);
  });

  it("verifies cancellation at 25% elapsed time", () => {
    const now = startTime + BigInt(250);
    const split = calculateStreamCancelSplit(totalAmount, startTime, endTime, now, BigInt(0));
    expect(split.vested).toBe(BigInt(2_500));
    expect(split.earnedUnclaimed).toBe(BigInt(2_500));
    expect(split.unvestedRefundable).toBe(BigInt(7_500));
    expect(split.isConserved).toBe(true);
  });

  it("verifies cancellation at 50% elapsed time with prior partial claim", () => {
    const now = startTime + BigInt(500);
    const claimedSoFar = BigInt(2_000);
    const split = calculateStreamCancelSplit(totalAmount, startTime, endTime, now, claimedSoFar);
    expect(split.vested).toBe(BigInt(5_000));
    expect(split.claimed).toBe(claimedSoFar);
    expect(split.earnedUnclaimed).toBe(BigInt(3_000)); // 5000 - 2000
    expect(split.unvestedRefundable).toBe(BigInt(5_000));
    expect(split.isConserved).toBe(true);
  });

  it("verifies cancellation at 75% elapsed time", () => {
    const now = startTime + BigInt(750);
    const split = calculateStreamCancelSplit(totalAmount, startTime, endTime, now, BigInt(0));
    expect(split.vested).toBe(BigInt(7_500));
    expect(split.earnedUnclaimed).toBe(BigInt(7_500));
    expect(split.unvestedRefundable).toBe(BigInt(2_500));
    expect(split.isConserved).toBe(true);
  });

  it("verifies cancellation at 100% elapsed time (all vested to recipient)", () => {
    const split = calculateStreamCancelSplit(totalAmount, startTime, endTime, endTime, BigInt(0));
    expect(split.vested).toBe(totalAmount);
    expect(split.earnedUnclaimed).toBe(totalAmount);
    expect(split.unvestedRefundable).toBe(BigInt(0));
    expect(split.isConserved).toBe(true);
  });

  it("ensures rounding always preserves strict solvency on odd amounts", () => {
    const oddAmount = BigInt(10_001);
    const now = startTime + BigInt(500); // 50% elapsed
    const split = calculateStreamCancelSplit(oddAmount, startTime, endTime, now, BigInt(0));
    // 10_001 * 500 / 1000 = 5_000
    expect(split.vested).toBe(BigInt(5_000));
    expect(split.unvestedRefundable).toBe(BigInt(5_001));
    expect(split.isConserved).toBe(true);
  });

  it("guards against zero duration streams without division by zero", () => {
    const zeroDurationVested = computeVestedAmount(totalAmount, startTime, startTime, startTime);
    expect(zeroDurationVested).toBe(totalAmount);
  });
});
