// SPDX-License-Identifier: MIT

/**
 * Currency formatting utilities for payment amounts.
 * Supports fiat, XLM, and token amount formatting with pinned en-US locale
 * for consistent decimal and thousands separators without platform flakiness.
 * Non-finite and negative inputs produce defined, documented results.
 */

export const DEFAULT_LOCALE = "en-US";
export const STROOPS_PER_XLM = 10_000_000; // 1e7
export const MAX_STELLAR_DECIMALS = 7;

export interface CurrencyFormatOptions {
  locale?: string;
  roundingMode?: "halfExpand" | "halfEven" | "floor" | "ceil" | "trunc";
}

/**
 * Safely parses and sanitizes amounts to finite numbers.
 */
function sanitizeAmount(amount: unknown, fallback = 0): number {
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : fallback;
  }
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!trimmed) return fallback;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Format a raw stroop amount as a human-readable XLM string.
 * Non-finite amounts produce "0.00" (or configured decimals).
 */
export function formatXlm(
  stroops: string | number,
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const num = sanitizeAmount(stroops, 0);
  const amount = num / STROOPS_PER_XLM;
  const locale = options?.locale || DEFAULT_LOCALE;

  const intlOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  if (options?.roundingMode) {
    intlOptions.roundingMode = options.roundingMode;
  }

  return new Intl.NumberFormat(locale, intlOptions).format(amount);
}

/**
 * Format any numeric amount as fiat currency (USD by default).
 * Non-finite amounts produce "$0.00" (or currency equivalent).
 */
export function formatFiat(
  amount: number | string,
  currency = "USD",
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const num = sanitizeAmount(amount, 0);
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
 * Non-finite amounts produce "0.00 {symbol}".
 */
export function formatTokenAmount(
  amount: number | string,
  symbol: string,
  decimals = 2,
  options?: CurrencyFormatOptions
): string {
  const num = sanitizeAmount(amount, 0);
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
 * Non-finite amounts produce "0".
 */
export function formatCompact(amount: number | string, options?: { locale?: string }): string {
  const num = sanitizeAmount(amount, 0);
  const locale = options?.locale || DEFAULT_LOCALE;

  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
  }).format(num);
}
