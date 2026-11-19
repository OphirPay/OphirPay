// SPDX-License-Identifier: MIT

export const STROOPS_PER_XLM = BigInt(10_000_000);

export function parseXlmAmount(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]) * STROOPS_PER_XLM +
    BigInt((match[2] ?? "").padEnd(7, "0") || "0");
}

/**
 * Format a stroop count as an exact, locale-independent XLM decimal string
 * (`"12500000"` → `"1.25"`, `"1"` → `"0.0000001"`).
 *
 * This is the inverse of {@link parseXlmAmount}: the output never uses
 * grouping, a unit suffix, scientific notation or rounding, so
 * `parseXlmAmount(formatXlmAmount(s)) === s` holds exactly for every
 * non-negative stroop count. Building the string from a `bigint` (never a
 * float) is what keeps that round-trip lossless for amounts above 2^53.
 */
export function formatXlmAmount(value: number | string | bigint): string {
  const stroops = BigInt(value);
  const negative = stroops < BigInt(0);
  const magnitude = negative ? -stroops : stroops;

  const whole = magnitude / STROOPS_PER_XLM;
  const fractional = (magnitude % STROOPS_PER_XLM)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");

  const body = fractional ? `${whole}.${fractional}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * Format a stroop amount for display with thousands grouping and a unit
 * (`"1,234,567,890,123,456,789.00 XLM"`), keeping a minimum of two decimals.
 *
 * Delegates the exact decimal to {@link formatXlmAmount} so the two formatters
 * can never disagree about precision.
 */
export function formatXlmStroops(value: number | string | bigint): string {
  const amount = formatXlmAmount(value);
  const [whole, fractional = ""] = amount.split(".");
  return `${new Intl.NumberFormat().format(BigInt(whole))}.${fractional.padEnd(2, "0")} XLM`;
}
