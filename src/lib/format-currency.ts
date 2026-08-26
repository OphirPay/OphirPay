// SPDX-License-Identifier: MIT

/**
 * Currency formatting utilities for payment amounts.
 * Supports fiat, XLM, and token amount formatting with locale awareness.
 */

const DEFAULT_LOCALE = "en-US";

/**
 * Format a raw stroop amount as a human-readable XLM string.
 */
export function formatXlm(stroops: string | number, decimals = 2): string {
  const amount = typeof stroops === "string" ? parseFloat(stroops) / 1e7 : stroops / 1e7;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Format any numeric amount as fiat currency (USD by default).
 */
export function formatFiat(
  amount: number | string,
  currency = "USD",
  decimals = 2
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
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
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
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
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    notation: "compact",
    compactDisplay: "short",
  }).format(num);
}
