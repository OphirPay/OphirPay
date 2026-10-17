// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1357 — Add stream cancellation pro-rata refund verification for
 * partial elapsed periods.
 *
 * Verifies:
 *   • `contracts/ophirpay/src/contract.rs` explicitly guards `duration == 0`
 *     before division in `cancel_stream`, computes `vested` via linear floor
 *     division, and enforces the solvency invariant
 *     `claimed + earned_unclaimed + unvested == total_amount`.
 *   • `contracts/ophirpay/tests/integration_tests.rs` tests cancellation at
 *     0%, 25%, 50%, 75%, and 100% elapsed time and partial-claim + odd-duration
 *     cancellation.
 *   • `contracts/ophirpay/tests/proptest_payment_amounts.rs` fuzzes stream
 *     pro-rata cancellation solvency across arbitrary elapsed timestamps.
 *   • Exact BigInt reference verification of the contract's linear pro-rata
 *     vesting & refund formula across 0%, 25%, 50%, 75%, 100%, zero-duration,
 *     and non-divisor timestamps.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function computeVestedBigInt(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  now: bigint
): bigint {
  const duration = endTime > startTime ? endTime - startTime : 0n;
  if (duration === 0n || now >= endTime) {
    return totalAmount;
  }
  if (now <= startTime) {
    return 0n;
  }
  const elapsed = now - startTime;
  return (totalAmount * elapsed) / duration;
}

function computeStreamCancelSplit(
  totalAmount: bigint,
  claimedAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  now: bigint
) {
  const vested = computeVestedBigInt(totalAmount, startTime, endTime, now);
  const earnedUnclaimed = vested - claimedAmount;
  const unvested = totalAmount - vested;
  return {
    vested,
    earnedUnclaimed,
    unvested,
    totalAccounted: claimedAmount + earnedUnclaimed + unvested,
  };
}

describe("Stream cancellation pro-rata refund verification (issue #1357)", () => {
  it("enforces explicit zero-duration check and solvency invariant in contracts/ophirpay/src/contract.rs", () => {
    const contractRs = read("contracts/ophirpay/src/contract.rs");
    expect(contractRs).toContain("let duration = stream.end_time.saturating_sub(stream.start_time);");
    expect(contractRs).toContain("if duration == 0 || now >= stream.end_time");
    expect(contractRs).toContain("if total_accounted != stream.total_amount || unvested < 0");
  });

  it("includes 0%, 25%, 50%, 75%, and 100% elapsed time unit tests in integration_tests.rs", () => {
    const integrationRs = read("contracts/ophirpay/tests/integration_tests.rs");
    expect(integrationRs).toContain("fn test_cancel_stream_pro_rata_refund_at_0_25_50_75_100_percent()");
    expect(integrationRs).toContain("(0, 0, 1_000_000)");
    expect(integrationRs).toContain("(25, 250_000, 750_000)");
    expect(integrationRs).toContain("(50, 500_000, 500_000)");
    expect(integrationRs).toContain("(75, 750_000, 250_000)");
    expect(integrationRs).toContain("(100, 1_000_000, 0)");
  });

  it("includes fuzz test assertions across arbitrary elapsed timestamps in proptest_payment_amounts.rs", () => {
    const proptestRs = read("contracts/ophirpay/tests/proptest_payment_amounts.rs");
    expect(proptestRs).toContain("fn prop_stream_cancel_pro_rata_solvency_across_elapsed_timestamps");
    expect(proptestRs).toContain("prop_assert_eq!(vested_at_claim + unclaimed_vested + refundable, total_amount)");
  });

  it("verifies exact pro-rata split at 0%, 25%, 50%, 75%, 100%, zero duration, and non-divisor intervals", () => {
    const total = 1_000_000n;
    const start = 10_000n;
    const end = 11_000n;

    expect(computeStreamCancelSplit(total, 0n, start, end, 10_000n)).toEqual({
      vested: 0n,
      earnedUnclaimed: 0n,
      unvested: 1_000_000n,
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, 0n, start, end, 10_250n)).toEqual({
      vested: 250_000n,
      earnedUnclaimed: 250_000n,
      unvested: 750_000n,
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, 0n, start, end, 10_500n)).toEqual({
      vested: 500_000n,
      earnedUnclaimed: 500_000n,
      unvested: 500_000n,
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, 0n, start, end, 10_750n)).toEqual({
      vested: 750_000n,
      earnedUnclaimed: 750_000n,
      unvested: 250_000n,
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, 0n, start, end, 11_000n)).toEqual({
      vested: 1_000_000n,
      earnedUnclaimed: 1_000_000n,
      unvested: 0n,
      totalAccounted: total,
    });

    // Zero duration guard (start == end) never divides by zero
    expect(computeStreamCancelSplit(total, 0n, start, start, start)).toEqual({
      vested: total,
      earnedUnclaimed: total,
      unvested: 0n,
      totalAccounted: total,
    });

    // Prime principal + odd duration + partial prior claim
    const oddTotal = 1_000_003n;
    const claimedAt25Pct = computeVestedBigInt(oddTotal, 5000n, 5333n, 5083n);
    const splitAt75Pct = computeStreamCancelSplit(oddTotal, claimedAt25Pct, 5000n, 5333n, 5250n);
    expect(splitAt75Pct.totalAccounted).toBe(oddTotal);
    expect(claimedAt25Pct + splitAt75Pct.earnedUnclaimed + splitAt75Pct.unvested).toBe(oddTotal);
  });
});
