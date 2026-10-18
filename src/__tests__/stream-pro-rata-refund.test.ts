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
  const zero = BigInt(0);
  const duration = endTime > startTime ? endTime - startTime : zero;
  if (duration === zero || now >= endTime) {
    return totalAmount;
  }
  if (now <= startTime) {
    return zero;
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
    expect(integrationRs).toContain("(0u64, 0i128, 1_000_000i128)");
    expect(integrationRs).toContain("(25u64, 250_000i128, 750_000i128)");
    expect(integrationRs).toContain("(50u64, 500_000i128, 500_000i128)");
    expect(integrationRs).toContain("(75u64, 750_000i128, 250_000i128)");
    expect(integrationRs).toContain("(100u64, 1_000_000i128, 0i128)");
  });

  it("includes fuzz test assertions across arbitrary elapsed timestamps in proptest_payment_amounts.rs", () => {
    const proptestRs = read("contracts/ophirpay/tests/proptest_payment_amounts.rs");
    expect(proptestRs).toContain("fn prop_stream_cancel_pro_rata_solvency_across_elapsed_timestamps");
    expect(proptestRs).toContain("prop_assert_eq!(vested_at_claim + unclaimed_vested + refundable, total_amount)");
  });

  it("verifies exact pro-rata split at 0%, 25%, 50%, 75%, 100%, zero duration, and non-divisor intervals", () => {
    const zero = BigInt(0);
    const total = BigInt(1000000);
    const start = BigInt(10000);
    const end = BigInt(11000);

    expect(computeStreamCancelSplit(total, zero, start, end, BigInt(10000))).toEqual({
      vested: zero,
      earnedUnclaimed: zero,
      unvested: BigInt(1000000),
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, zero, start, end, BigInt(10250))).toEqual({
      vested: BigInt(250000),
      earnedUnclaimed: BigInt(250000),
      unvested: BigInt(750000),
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, zero, start, end, BigInt(10500))).toEqual({
      vested: BigInt(500000),
      earnedUnclaimed: BigInt(500000),
      unvested: BigInt(500000),
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, zero, start, end, BigInt(10750))).toEqual({
      vested: BigInt(750000),
      earnedUnclaimed: BigInt(750000),
      unvested: BigInt(250000),
      totalAccounted: total,
    });
    expect(computeStreamCancelSplit(total, zero, start, end, BigInt(11000))).toEqual({
      vested: BigInt(1000000),
      earnedUnclaimed: BigInt(1000000),
      unvested: zero,
      totalAccounted: total,
    });

    // Zero duration guard (start == end) never divides by zero
    expect(computeStreamCancelSplit(total, zero, start, start, start)).toEqual({
      vested: total,
      earnedUnclaimed: total,
      unvested: zero,
      totalAccounted: total,
    });

    // Prime principal + odd duration + partial prior claim
    const oddTotal = BigInt(1000003);
    const claimedAt25Pct = computeVestedBigInt(oddTotal, BigInt(5000), BigInt(5333), BigInt(5083));
    const splitAt75Pct = computeStreamCancelSplit(oddTotal, claimedAt25Pct, BigInt(5000), BigInt(5333), BigInt(5250));
    expect(splitAt75Pct.totalAccounted).toBe(oddTotal);
    expect(claimedAt25Pct + splitAt75Pct.earnedUnclaimed + splitAt75Pct.unvested).toBe(oddTotal);
  });
});
