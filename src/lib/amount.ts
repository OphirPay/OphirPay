// SPDX-License-Identifier: MIT

/**
 * Amount formatting utilities for precise blockchain display.
 * Handles large numbers, compact notation, and consistent precision.
 * Guarantees safe, documented fallbacks for non-finite (NaN, Infinity)
 * and negative inputs without silent NaN propagation.
 */

export const STELLAR_MAX_DECIMALS = 7;
export const STROOPS_PER_XLM = 10_000_000; // 1 XLM = 10,000,000 stroops

/**
 * Safely sanitizes numeric inputs, ensuring a finite number or returning fallback.
 */
function sanitizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Format a number with compact notation for large values (e.g., 1.2M, 450K).
 * Non-finite inputs return "0.00" (or configured decimals).
 */
export function formatCompactAmount(value: number, decimals = 2): string {
  const safe = sanitizeNumber(value, 0);
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);

  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(decimals)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(decimals)}`;
}

/**
 * Format stroops to a clean XLM display (e.g., 12500000 → "1.25", 1 → "0.0000001").
 * Pins 7-decimal Stellar precision limit without scientific notation (e.g. 1e-7).
 * Trailing zeros are stripped. Non-finite inputs return "0".
 */
export function stroopsToDisplay(stroops: number, maxDecimals = STELLAR_MAX_DECIMALS): string {
  const safe = sanitizeNumber(stroops, 0);
  const xlm = safe / STROOPS_PER_XLM;
  const clampedDecimals = Math.max(0, Math.min(STELLAR_MAX_DECIMALS, maxDecimals));
  const fixed = xlm.toFixed(clampedDecimals);
  if (!fixed.includes(".")) return fixed;
  const stripped = fixed.replace(/\.?0+$/, "");
  return stripped === "-0" || stripped === "" ? "0" : stripped;
}

/**
 * Pad a number to a fixed number of decimal places with trailing zeros removed.
 * Avoids scientific notation corruption for small fractional values.
 * Non-finite inputs return "0".
 */
export function formatDecimal(value: number, maxDecimals = STELLAR_MAX_DECIMALS): string {
  const safe = sanitizeNumber(value, 0);
  const clampedDecimals = Math.max(0, Math.min(STELLAR_MAX_DECIMALS, maxDecimals));
  const fixed = safe.toFixed(clampedDecimals);
  if (!fixed.includes(".")) return fixed;
  const stripped = fixed.replace(/\.?0+$/, "");
  return stripped === "-0" || stripped === "" ? "0" : stripped;
}

/**
 * Format a range like "$10.00 — $50.00" or just "$10.00" if min === max.
 * Non-finite inputs fall back to 0.
 */
export function formatAmountRange(min: number, max: number, symbol = ""): string {
  const safeMin = sanitizeNumber(min, 0);
  const safeMax = sanitizeNumber(max, 0);
  const fmt = (v: number) => `${symbol}${formatDecimal(v, 2)}`;
  if (safeMin === safeMax) return fmt(safeMin);
  return `${fmt(safeMin)} — ${fmt(safeMax)}`;
}
