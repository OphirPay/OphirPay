// SPDX-License-Identifier: MIT

/**
 * Fee estimation utilities.
 *
 * This module replaces the previous static network base fee with a dynamic
 * recommendation derived from Horizon's fee statistics. It caches the result
 * for a short interval to avoid excessive network calls and provides a fallback
 * value when Horizon is unreachable.
 */

export interface FeeRecommendation {
  /** Recommended fee in stroops (1 stroop = 0.00001 XLM). */
  fee: number;
  /** Indicates whether the fee came from live Horizon data or a fallback. */
  basis: "live" | "fallback";
  /** Unix timestamp (ms) when the recommendation was generated. */
  timestamp: number;
}

/** Default fallback fee (stroops) used when Horizon cannot be queried. */
const FALLBACK_FEE = 100; // 0.0010 XLM
/** How often we refresh the fee recommendation (ms). */
const REFRESH_INTERVAL = 30_000; // 30 seconds
/** Horizon endpoint that returns fee statistics. */
const HORIZON_FEE_STATS_URL = "https://horizon.stellar.org/fee_stats";
/** Percentile to use for the recommendation. 90th percentile provides a balanced aggressiveness. */
const RECOMMENDATION_PERCENTILE = "fee_charged_p90" as const;

let cachedRecommendation: FeeRecommendation | null = null;
let lastFetch = 0;

/**
 * Fetches the latest fee statistics from Horizon and returns a {@link FeeRecommendation}.
 * The function respects {@link REFRESH_INTERVAL} and will return a cached value if the
 * interval has not elapsed.
 */
export async function getRecommendedFee(): Promise<FeeRecommendation> {
  const now = Date.now();
  if (cachedRecommendation && now - lastFetch < REFRESH_INTERVAL) {
    return cachedRecommendation;
  }

  try {
    const response = await fetch(HORIZON_FEE_STATS_URL);
    if (!response.ok) {
      throw new Error(`Horizon responded with ${response.status}`);
    }
    const data = await response.json();
    // Horizon returns fee stats under `last_ledger_base_fee` and a nested `fee_charged` object.
    // We use the configured percentile (e.g., fee_charged_p90) for the recommendation.
    const rawFeeStr = data?.last_ledger_base_fee ?? "100"; // fallback to 100 stroops if missing
    const percentileFeeStr = data?.fee_charged?.[RECOMMENDATION_PERCENTILE] ?? rawFeeStr;
    const rawFee = parseInt(rawFeeStr, 10);
    const percentileFee = parseInt(percentileFeeStr, 10);
    // Choose the higher of the static base fee and the percentile fee to avoid under‑pricing.
    const fee = Math.max(FALLBACK_FEE, Math.max(rawFee, percentileFee));
    cachedRecommendation = { fee, basis: "live", timestamp: now };
  } catch (error) {
    // On any error (network, parsing, etc.) fall back to the last known good value or the static fallback.
    cachedRecommendation = cachedRecommendation ?? { fee: FALLBACK_FEE, basis: "fallback", timestamp: now };
    // Ensure the basis reflects that we are using a fallback.
    if (cachedRecommendation.basis !== "fallback") {
      cachedRecommendation = { ...cachedRecommendation, basis: "fallback" };
    }
  }

  lastFetch = now;
  return cachedRecommendation as FeeRecommendation;
}

/**
 * Clears the internal cache. Primarily useful for testing.
 */
export function _clearFeeCache(): void {
  cachedRecommendation = null;
  lastFetch = 0;
}
