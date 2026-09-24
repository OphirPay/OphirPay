/**
 * Fee Estimator
 *
 * This module provides a dynamic fee recommendation based on Horizon's fee
 * statistics. It falls back to a cached or static value when Horizon is
 * unreachable. The recommendation is refreshed on a configurable interval.
 */

export interface FeeRecommendation {
  /** Recommended fee in stroops */
  fee: number;
  /** Indicates whether the fee came from live Horizon data or a fallback */
  basis: 'live' | 'fallback';
  /** Unix timestamp (ms) when the recommendation was generated */
  timestamp: number;
}

// Default fallback fee (stroops) – matches the historic static value used by the app.
const FALLBACK_FEE = 100;
// How often we re‑fetch Horizon stats (ms). Adjust via environment if needed.
const REFRESH_INTERVAL = 30_000; // 30 seconds

let cachedFee: FeeRecommendation | null = null;
let lastFetch = 0;

/**
 * Retrieves a fee recommendation.
 *
 * - If a cached recommendation is recent enough, it is returned directly.
 * - Otherwise we attempt to fetch `https://horizon.stellar.org/fee_stats`.
 *   The response's `last_fee_statistics.fee_charged_max` field is used as the
 *   raw fee. We apply a 0.9 multiplier (≈ P90) to keep the fee aggressive but
 *   safe.
 * - On any error we fall back to the previously cached recommendation or the
 *   static `FALLBACK_FEE`.
 */
export async function getRecommendedFee(): Promise<FeeRecommendation> {
  const now = Date.now();

  // Return cached value if still within the refresh window.
  if (cachedFee && now - lastFetch < REFRESH_INTERVAL) {
    return cachedFee;
  }

  try {
    const response = await fetch('https://horizon.stellar.org/fee_stats');
    if (!response.ok) {
      throw new Error(`Horizon responded with ${response.status}`);
    }
    const data = await response.json();

    // Horizon's fee stats may be nested; guard against missing fields.
    const rawFeeStr = data?.last_fee_statistics?.fee_charged_max ?? `${FALLBACK_FEE}`;
    const rawFee = parseInt(rawFeeStr, 10);
    // Apply aggressiveness factor (P90). Adjust multiplier if a different policy is desired.
    const fee = Math.max(FALLBACK_FEE, Math.ceil(rawFee * 0.9));

    cachedFee = { fee, basis: 'live', timestamp: now };
  } catch (error) {
    // If we already have a cached value, keep using it; otherwise use static fallback.
    if (!cachedFee) {
      cachedFee = { fee: FALLBACK_FEE, basis: 'fallback', timestamp: now };
    } else {
      // Mark the existing cached value as fallback for clarity.
      cachedFee = { ...cachedFee, basis: 'fallback', timestamp: now };
    }
  }

  lastFetch = now;
  return cachedFee as FeeRecommendation;
}
