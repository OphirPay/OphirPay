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

export const DEFAULT_LOCALE = "en-US";
export const STROOPS_PER_XLM = 10_000_000; // 1e7
export const MAX_STELLAR_DECIMALS = 7;

export interface CurrencyFormatOptions {
  locale?: string;
  roundingMode?: "halfExpand" | "halfEven" | "floor" | "ceil" | "trunc";
}

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
 * Non-finite amounts produce NON_FINITE_AMOUNT ("—").
 */
export function formatXlm(
  stroops: string | number,
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const parsed = toFiniteNumber(stroops);
  if (parsed === null) return NON_FINITE_AMOUNT;
  const locale = options?.locale || DEFAULT_LOCALE;

  const intlOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  if (options?.roundingMode) {
    intlOptions.roundingMode = options.roundingMode;
  }

  return new Intl.NumberFormat(locale, intlOptions).format(parsed / STROOPS_PER_XLM);
}

/**
 * Format any numeric amount as fiat currency (USD by default).
 * Non-finite amounts produce NON_FINITE_AMOUNT ("—").
 */
export function formatFiat(
  amount: number | string,
  currency = "USD",
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  const locale = options?.locale || DEFAULT_LOCALE;

  const intlOptions: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  if (options?.roundingMode) {
    intlOptions.roundingMode = options.roundingMode;
  }

  return new Intl.NumberFormat(locale, intlOptions).format(num);
}

/**
 * Format a token amount with its symbol.
 * Non-finite amounts produce NON_FINITE_AMOUNT ("—").
 */
export function formatTokenAmount(
  amount: number | string,
  symbol: string,
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  const locale = options?.locale || DEFAULT_LOCALE;

  const intlOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  if (options?.roundingMode) {
    intlOptions.roundingMode = options.roundingMode;
  }

  const formatted = new Intl.NumberFormat(locale, intlOptions).format(num);
  return `${formatted} ${symbol}`;
}

/**
 * Compact number formatting (e.g. 1.2K, 3.4M).
 * Non-finite amounts produce NON_FINITE_AMOUNT ("—").
 */
export function formatCompact(amount: number | string, options?: { locale?: string }): string {
  const num = toFiniteNumber(amount);
  if (num === null) return NON_FINITE_AMOUNT;
  const locale = options?.locale || DEFAULT_LOCALE;

  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
  }).format(num);
}
