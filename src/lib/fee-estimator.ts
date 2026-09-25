// SPDX-License-Identifier: MIT

import { getHorizonServer } from "@/lib/stellar";
import { getFeeRecommendation, type Aggressiveness, type FeeSource } from "@/lib/network-fee-stats";

interface FeeEstimate {
  baseFee: string;
  estimatedFee: string;
  operations: number;
  networkCongestion: "low" | "medium" | "high";
  /** Where `baseFee` came from — `horizon`, `cache` or `fallback`. */
  source?: FeeSource;
  /** True when Horizon was unreachable and this is a cached/configured value. */
  stale?: boolean;
  /** Human-readable justification for the fee, suitable for display. */
  basis?: string;
}

/**
 * Congestion band for a per-operation base fee.
 *
 * Thresholds are part of the public contract of this module (they drive the
 * badge colour on the send screen), so they are unchanged: >200 stroops is
 * high, >100 is medium, otherwise low.
 */
function congestionForBaseFee(baseFee: number): FeeEstimate["networkCongestion"] {
  if (baseFee > 200) return "high";
  if (baseFee > 100) return "medium";
  return "low";
}

/**
 * Estimate the fee for a Stellar transaction from the network's *current*
 * base fee, straight from Horizon.
 *
 * This is the direct, single-value path used by the confirmation screens. It
 * never throws: a failed or nonsensical response yields the protocol minimum
 * (100 stroops) so the user still sees a signable estimate.
 *
 * For fee recommendations that account for congestion via Horizon fee
 * statistics (issue #825), use `estimateTransactionFeeFromStats`.
 */
export async function estimateTransactionFee(numOperations = 1): Promise<FeeEstimate> {
  const operations = Math.max(1, numOperations);

  try {
    const server = getHorizonServer();
    const baseFeeResponse = await server.fetchBaseFee();
    const baseFee = parseFloat(baseFeeResponse.toString());
    if (!Number.isFinite(baseFee) || baseFee <= 0) throw new Error("invalid base fee");

    return {
      baseFee: baseFee.toString(),
      estimatedFee: (baseFee * operations).toString(),
      operations,
      networkCongestion: congestionForBaseFee(baseFee),
      source: "horizon",
      stale: false,
    };
  } catch {
    // Fallback to the protocol minimum of 100 stroops.
    return {
      baseFee: "100",
      estimatedFee: (100 * operations).toString(),
      operations,
      networkCongestion: "low",
      source: "fallback",
      stale: true,
    };
  }
}

/**
 * Fee estimate derived from Horizon `/fee_stats` under an aggressiveness
 * policy — issue #825.
 *
 * Unlike `estimateTransactionFee`, which reports the base fee as-is, this
 * recommends the fee that will actually be included in the next ledger while
 * the network is congested, and states the basis for that number. It also
 * never throws: an unreachable Horizon yields the last known good value, or
 * the configured fallback, tagged `stale`.
 */
export async function estimateTransactionFeeFromStats(
  numOperations = 1,
  options: { aggressiveness?: Aggressiveness } = {},
): Promise<FeeEstimate> {
  const operations = Math.max(1, numOperations);
  const rec = await getFeeRecommendation({ operations, aggressiveness: options.aggressiveness });

  return {
    baseFee: rec.baseFeeStroops.toString(),
    estimatedFee: rec.totalStroops.toString(),
    operations,
    networkCongestion: rec.congestion,
    source: rec.source,
    stale: rec.stale,
    basis: rec.basis,
  };
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 * Each recipient = 1 payment operation.
 *
 * Pure and synchronous by design: callers that need a fee to sign with should
 * use `estimateTransactionFee` (or the stats variant), which consult Horizon.
 */
export function estimateBatchFee(recipientCount: number, baseFee = 100): string {
  return (baseFee * Math.max(0, recipientCount)).toString();
}
