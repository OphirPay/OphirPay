// SPDX-License-Identifier: MIT

/**
 * Amount formatting utilities for precise blockchain display.
 * Handles large numbers, compact notation, and consistent precision.
 *
 * Display contract:
 *   • A finite value renders with at most `maxDecimals` decimals and never in
 *     exponential notation (`0.0000001`, not `1e-7`) — these strings are shown
 *     to users paying with real money.
 *   • A non-finite value (`NaN`, `Infinity`) renders as {@link NON_FINITE_AMOUNT}
 *     rather than leaking `NaN`/`Infinity` into the UI.
 */

/** Rendered in place of a value that is not a finite number. */
export const NON_FINITE_AMOUNT = "—";
export const STELLAR_MAX_DECIMALS = 7;
export const STROOPS_PER_XLM = 10_000_000; // 1 XLM = 10,000,000 stroops

/** `toFixed` returns exponential notation for magnitudes at or above this. */
const TO_FIXED_EXPONENTIAL_LIMIT = 1e21;

/** Strip the padding `toFixed` adds, without losing small magnitudes. */
function trimTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

/** Format a number with compact notation for large values (e.g., 1.2M, 450K). */
export function formatCompactAmount(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return NON_FINITE_AMOUNT;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

/** Format stroops to a clean XLM display (e.g., 12500000 → "1.25", 1 → "0.0000001"). */
export function stroopsToDisplay(stroops: number, maxDecimals = STELLAR_MAX_DECIMALS): string {
  if (!Number.isFinite(stroops)) return NON_FINITE_AMOUNT;
  const clampedDecimals = Math.max(0, Math.min(STELLAR_MAX_DECIMALS, maxDecimals));
  return formatDecimal(stroops / STROOPS_PER_XLM, clampedDecimals);
}

/** Pad a number to a fixed number of decimal places with trailing zeros removed. */
export function formatDecimal(value: number, maxDecimals = STELLAR_MAX_DECIMALS): string {
  if (!Number.isFinite(value)) return NON_FINITE_AMOUNT;

  const clampedDecimals = Math.max(0, Math.min(STELLAR_MAX_DECIMALS, maxDecimals));
  const fixed = value.toFixed(clampedDecimals);
  // `toFixed` gives up beyond 2^53-scale magnitudes and hands back exponential
  // notation; Intl formats the same value in full.
  if (Math.abs(value) >= TO_FIXED_EXPONENTIAL_LIMIT) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: clampedDecimals,
      useGrouping: false,
    }).format(value);
  }
  const trimmed = trimTrailingZeros(fixed);
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/**
 * Format a range like "$10.00 — $50.00" or just "$10.00" if min === max.
 * Non-finite inputs fall back to NON_FINITE_AMOUNT.
 */
export function formatAmountRange(min: number, max: number, symbol = ""): string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return NON_FINITE_AMOUNT;
  const fmt = (v: number) => `${symbol}${formatDecimal(v, 2)}`;
  if (min === max) return fmt(min);
  return `${fmt(min)} — ${fmt(max)}`;
}
