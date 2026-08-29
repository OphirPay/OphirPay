// SPDX-License-Identifier: MIT

/**
 * Currency display and price conversion utilities.
 * Handles XLM <-> USD conversion, deterministic formatting, fallback states,
 * and localStorage preference persistence.
 *
 * Rounding & Formatting Rules:
 * - XLM: Formatted with standard thousands separators and up to 7 decimal places (Stellar Stroop precision).
 *        Falls back to "—" for invalid/non-numeric inputs.
 * - USD: Derived from external price feed, formatted to fixed 2 decimal places with standard currency symbol ($).
 *        If price feed is unavailable, null, invalid, or non-positive, returns "Unavailable".
 * - Conversions: XLM * priceRate -> USD. Returns null if price is unavailable, ensuring safe fallback.
 */

export type CurrencyDisplay = "XLM" | "USD";

export interface PriceSource {
  xlmUsd: number | null;
  updatedAt?: string;
  source?: string;
  error?: string | null;
}

export const STORAGE_KEYS = {
  currencyDisplay: "payments.currencyDisplay",
} as const;

export const DEFAULT_CURRENCY: CurrencyDisplay = "XLM";

export const XLM_STROOPS = 10_000_000;
export const XLM_DECIMALS = 7;
export const USD_DECIMALS = 2;

/**
 * Check whether a value is a finite non-negative number.
 */
export function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Normalize an unknown or stored value into a valid CurrencyDisplay mode.
 */
export function normalizeCurrencyDisplay(value: unknown): CurrencyDisplay {
  return value === "USD" ? "USD" : "XLM";
}

/**
 * XLM formatting rules:
 * - Formats valid non-negative amounts with localized separators
 * - Displays 2 to 7 decimal places
 * - Never returns NaN or Infinity
 * - Returns '—' for invalid amounts
 */
export function formatXlmAmount(amountXlm: number): string {
  if (!isFinitePositiveNumber(amountXlm)) return "—";
  return amountXlm.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: XLM_DECIMALS,
  });
}

/**
 * USD formatting rules:
 * - Derived from validated external price feed
 * - Uses exact 2-decimal USD currency formatting (e.g. "$12.50")
 * - If price is null/undefined or invalid, returns "Unavailable" fallback
 */
export function formatUsdAmount(amountUsd: number | null | undefined): string {
  if (!isFinitePositiveNumber(amountUsd)) return "Unavailable";
  return amountUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: USD_DECIMALS,
    maximumFractionDigits: USD_DECIMALS,
  });
}

/**
 * Safely converts XLM amount to USD using price rate.
 * Returns null if amount is invalid, or if rate is null/invalid/<= 0.
 */
export function convertXlmToUsd(
  amountXlm: number,
  price: PriceSource | number | null | undefined
): number | null {
  if (!isFinitePositiveNumber(amountXlm)) return null;

  const rate =
    typeof price === "number"
      ? price
      : price && typeof price === "object"
      ? price.xlmUsd
      : null;

  if (!isFinitePositiveNumber(rate) || rate === 0) return null;

  const converted = amountXlm * rate;
  return Number.isFinite(converted) && converted >= 0 ? converted : null;
}

/**
 * High-level helper to format payment amount for the payments table:
 * Given amount in stroops and selected currency display,
 * returns formatted string representation.
 */
export function formatPaymentRowAmount(
  amountStroops: number,
  currency: CurrencyDisplay,
  priceRate?: number | PriceSource | null
): string {
  const amountXlm = amountStroops / XLM_STROOPS;
  if (!isFinitePositiveNumber(amountXlm)) return "—";

  if (currency === "USD") {
    const usd = convertXlmToUsd(amountXlm, priceRate);
    if (usd === null) return "Unavailable";
    return formatUsdAmount(usd);
  }

  // XLM mode
  return `${formatXlmAmount(amountXlm)} XLM`;
}

/**
 * Fetch current XLM price in USD with abort signal support and error handling.
 */
export async function fetchXlmPrice(options?: {
  signal?: AbortSignal;
}): Promise<PriceSource> {
  try {
    const res = await fetch("/api/price", {
      signal: options?.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        xlmUsd: null,
        error: `Price service returned HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    const rate = data?.price ?? data?.xlmUsd ?? data?.rate;
    if (isFinitePositiveNumber(rate) && rate > 0) {
      return {
        xlmUsd: rate,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        source: data.source ?? "price-oracle",
      };
    }
    return {
      xlmUsd: null,
      error: "Invalid price rate received",
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    return {
      xlmUsd: null,
      error: err instanceof Error ? err.message : "Failed to fetch price",
    };
  }

}
