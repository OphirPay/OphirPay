// SPDX-License-Identifier: MIT

/**
 * Fee Estimator utilities.
 *
 * Previously the network base fee was a static constant, which could lead to
 * underpriced transactions during periods of high network congestion. This
 * module now fetches live fee statistics from Horizon and provides a recommended
 * fee based on a configurable aggressiveness policy. When Horizon is
 * unreachable, a cached or fallback fee is used.
 */

export interface FeeRecommendation {
  /** Recommended fee in stroops */
  fee: number;
  /** Indicates whether the fee came from live Horizon data or a fallback */
  basis: "live" | "fallback";
  /** Unix timestamp (ms) when the recommendation was generated */
  timestamp: number;
}

// Default fallback fee (in stroops) used when Horizon cannot be reached.
const FALLBACK_FEE = 100;
// How often we refresh the fee statistics from Horizon (30 seconds).
const REFRESH_INTERVAL = 30_000;

let cachedFee: FeeRecommendation | null = null;
let lastFetch = 0;

/**
 * Fetches the latest fee recommendation.
 *
 * The function respects a refresh interval to avoid hammering Horizon. It
 * attempts to fetch `https://horizon.stellar.org/fee_stats` and uses the P90
 * (90th percentile) fee as a balanced aggressiveness setting. If the request
 * fails, the previously cached recommendation is returned; if none exists, a
 * static fallback fee is provided.
 */
export async function getRecommendedFee(): Promise<FeeRecommendation> {
  const now = Date.now();
  if (cachedFee && now - lastFetch < REFRESH_INTERVAL) {
    return cachedFee;
  }

  try {
    const response = await fetch("https://horizon.stellar.org/fee_stats");
    if (!response.ok) {
      throw new Error("Horizon unavailable");
    }
    const data = await response.json();
    // Horizon returns fee statistics under `last_ledger_base_fee` and a
    // `fee_charged` object with percentile values. We use the 90th percentile
    // (fee_charged.p90) for a reasonable aggressiveness.
    const rawFeeStr = data?.last_ledger_base_fee ?? data?.fee_charged?.p90;
    const rawFee = typeof rawFeeStr === "string" ? parseInt(rawFeeStr, 10) : NaN;
    const fee = Number.isNaN(rawFee) ? FALLBACK_FEE : Math.max(FALLBACK_FEE, Math.ceil(rawFee * 0.9));
    cachedFee = { fee, basis: "live", timestamp: now };
  } catch {
    // On any error, fall back to the previously cached value or the static fallback.
    cachedFee = cachedFee || { fee: FALLBACK_FEE, basis: "fallback", timestamp: now };
  }

  lastFetch = now;
  return cachedFee as FeeRecommendation;
}

/**
 * Helper to format a fee (stroops) as XLM string with 7 decimal places.
 */
export function formatFeeStroops(fee: number): string {
  return (fee / 10_000_000).toFixed(7) + " XLM";
}
