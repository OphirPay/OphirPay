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
 *
 * Parse contract:
 *   • {@link parseAmount} accepts a *complete* decimal number and rejects
 *     anything else. `parseFloat` reads a numeric prefix, so it silently turns
 *     `"12px"` into `12` and `"1,234.50"` into `1` — a quiet money bug. Nothing
 *     here ever partially parses.
 */

/** Rendered in place of a value that is not a finite number. */
export const NON_FINITE_AMOUNT = "—";

/**
 * A complete, optionally-signed decimal number — and nothing else. Anchored so
 * a locale-formatted ("1,234.50") or partially-numeric ("12px") string is
 * rejected rather than silently truncated. An optional scientific exponent is
 * accepted, matching `Number()`.
 */
const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Strictly parse a number or numeric string into a finite number, or `null`.
 *
 * Unlike `parseFloat`, this never partially parses: `"12px"`, `"1,234.50"`,
 * `""`, `"abc"` and `NaN`/`Infinity` all return `null`. Whitespace around a
 * complete number is tolerated (including non-breaking Unicode whitespace).
 */
export function parseAmount(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!NUMERIC_STRING.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

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
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

/** Format stroops to a clean XLM display (e.g., 12500000 → "12.50"). */
export function stroopsToDisplay(stroops: number, maxDecimals = 7): string {
  return formatDecimal(stroops / 1e7, maxDecimals);
}

/** Pad a number to a fixed number of decimal places with trailing zeros removed. */
export function formatDecimal(value: number, maxDecimals = 7): string {
  if (!Number.isFinite(value)) return NON_FINITE_AMOUNT;

  const fixed = value.toFixed(maxDecimals);
  // `toFixed` gives up beyond 2^53-scale magnitudes and hands back exponential
  // notation; Intl formats the same value in full.
  if (Math.abs(value) >= TO_FIXED_EXPONENTIAL_LIMIT) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: maxDecimals,
      useGrouping: false,
    }).format(value);
  }
  return trimTrailingZeros(fixed);
}

/** Format a range like "$10.00 — $50.00" or just "$10.00" if min === max. */
export function formatAmountRange(min: number, max: number, symbol = ""): string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return NON_FINITE_AMOUNT;
  const fmt = (v: number) => `${symbol}${formatDecimal(v, 2)}`;
  if (min === max) return fmt(min);
  return `${fmt(min)} — ${fmt(max)}`;
}
