// SPDX-License-Identifier: MIT

/**
 * Amount formatting utilities for precise blockchain display.
 * Handles large numbers, compact notation, and consistent precision.
 */

/** Format a number with compact notation for large values (e.g., 1.2M, 450K). */
export function formatCompactAmount(value: number, decimals = 2): string {
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

/** Format stroops to a clean XLM display (e.g., 12500000 → "12.50"). */
export function stroopsToDisplay(stroops: number, maxDecimals = 7): string {
  const xlm = stroops / 1e7;
  // Remove trailing zeros after decimal
  return parseFloat(xlm.toFixed(maxDecimals)).toString();
}

/** Pad a number to a fixed number of decimal places with trailing zeros removed. */
export function formatDecimal(value: number, maxDecimals = 7): string {
  return parseFloat(value.toFixed(maxDecimals)).toString();
}

/** Format a range like "$10.00 — $50.00" or just "$10.00" if min === max. */
export function formatAmountRange(min: number, max: number, symbol = ""): string {
  const fmt = (v: number) => `${symbol}${formatDecimal(v, 2)}`;
  if (min === max) return fmt(min);
  return `${fmt(min)} — ${fmt(max)}`;
}
