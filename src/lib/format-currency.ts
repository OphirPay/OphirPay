// SPDX-License-Identifier: MIT

/**
 * Currency formatting utilities for payment amounts.
 * Supports fiat, XLM, and token amount formatting with locale awareness.
 *
 * The locale is pinned to `en-US` so the output — and therefore the tests and
 * any snapshot — never depends on the runtime's default locale. A value that
 * is not a finite number (including an unparseable numeric string) renders as
 * {@link NON_FINITE_AMOUNT} rather than leaking `NaN` or `Infinity` into a
 * payment UI.
 */

const DEFAULT_LOCALE = "en-US";

/** Rendered in place of a value that is not a finite number. */
export const NON_FINITE_AMOUNT = "—";

/**
 * A complete, optionally-signed decimal number — and nothing else. Anchored on
 * purpose: `parseFloat` accepts a numeric *prefix*, so it reads the locale
 * formatted "1,234.50" as `1` and "12px" as `12`, quietly formatting the wrong
 * amount. Money must never be partially parsed.
 */
const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse a number-or-numeric-string, returning null when it is not a complete,
 * finite number.
 */
function toFiniteNumber(amount: number | string): number | null {
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!NUMERIC_STRING.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Format a raw stroop amount as a human-readable XLM string.
 */
export function formatXlm(stroops: string | number, decimals = 2): string {
  const parsed = toFiniteNumber(stroops);
  if (parsed === null) return NON_FINITE_AMOUNT;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(parsed / 1e7);
}

/**
 * Format any numeric amount as fiat currency (USD by default).
 */
export function formatFiat(
  amount: number | string,
  currency = "USD",
  decimals = 2
): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format a token amount with its symbol.
 */
export function formatTokenAmount(
  amount: number | string,
  symbol: string,
  decimals = 2
): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  const formatted = new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
  return `${formatted} ${symbol}`;
}

/**
 * Compact number formatting (e.g. 1.2K, 3.4M).
 */
export function formatCompact(amount: number | string): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: "compact",
    compactDisplay: "short",
  }).format(num);
}
