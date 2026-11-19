// SPDX-License-Identifier: MIT

import {
  getRecommendedFee,
  type FeeAggressiveness,
  type FeeRecommendation,
  type FeeSource,
  type NetworkCongestion,
} from "@/lib/fee-stats";

export interface FeeEstimate {
  /** Network base fee from the latest Horizon sample, in stroops. */
  baseFee: string;
  /** Recommended fee per operation, in stroops. */
  estimatedFee: string;
  /** Recommended fee for the whole transaction, in stroops. */
  recommendedFee: string;
  /** Total for `operations`, in stroops. */
  totalFee: string;
  operations: number;
  networkCongestion: NetworkCongestion;
  /** Percentile bucket the aggressiveness policy selected (e.g. "p90"). */
  percentile: string;
  aggressiveness: FeeAggressiveness;
  /** Where the recommendation came from — "horizon" | "cache" | "fallback". */
  source: FeeSource;
  /** True when the recommendation is cached/fallback rather than fresh. */
  stale: boolean;
  /** Human-readable explanation of the fee (issue #825). */
  basis: string;
}

/**
 * Estimate the fee for a Stellar transaction from Horizon fee statistics
 * (issue #825).
 *
 * Formerly this hardcoded the network base fee, which tracks the protocol
 * floor but not congestion — during a fee spike the estimate (and the signed
 * transaction built from it) was underbid. It now delegates to
 * `getRecommendedFee`, which applies a configurable aggressiveness policy to
 * Horizon's `fee_charged` percentiles and degrades to a cached/configured
 * value when Horizon is unreachable.
 *
 * The recommendation is per operation; `estimatedFee` therefore already
 * includes the operation count.
 */
export async function estimateTransactionFee(
  numOperations = 1
): Promise<FeeEstimate> {
  const operations = Math.max(1, Math.floor(numOperations));
  const recommendation: FeeRecommendation = await getRecommendedFee();
  const perOp = recommendation.recommendedFee;

  return {
    baseFee: recommendation.baseFee.toString(),
    estimatedFee: (perOp * operations).toString(),
    recommendedFee: perOp.toString(),
    totalFee: (perOp * operations).toString(),
    operations,
    networkCongestion: recommendation.congestion,
    percentile: recommendation.percentile,
    aggressiveness: recommendation.aggressiveness,
    source: recommendation.source,
    stale: recommendation.stale,
    basis: recommendation.basis,
  };
}

/**
 * Calculate the estimated total fee for a batch payment with N recipients.
 * Each recipient = 1 payment operation.
 *
 * `baseFee` is the per-operation fee, in stroops — pass the value from
 * `estimateTransactionFee` (or `getRecommendedFee`) so the batch confirmation
 * quotes the same fee the transaction will carry.
 */
export function estimateBatchFee(recipientCount: number, baseFee = 100): string {
  const count = Math.max(0, Math.floor(recipientCount));
  return (baseFee * count).toString();
}
