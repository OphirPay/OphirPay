// SPDX-License-Identifier: MIT

/**
 * Stellar token amount formatting utilities for precision-critical displays.
 * Supports exact decimal values, micro-stroop amounts, and large int64 representations
 * without loss of precision or floating-point overflow.
 */

export const STROOPS_PER_XLM = 10_000_000n;
export const MAX_INT64 = 9223372036854775807n;
export const MIN_INT64 = -9223372036854775808n;

export interface FormatStellarAmountOptions {
  /** When true, input amount is treated as stroops (1 XLM = 10,000,000 stroops). Default false. */
  inStroops?: boolean;
  /** Maximum number of decimal places to include (default 7). */
  maxDecimals?: number;
  /** Whether to trim trailing zeros after decimal point (default true). */
  trimTrailingZeros?: boolean;
}

/**
 * Format a Stellar token amount or stroop count without precision loss.
 * Handles edge cases: 0, 0.0000001 (1 stroop), negative numbers, and MAX_INT64.
 */
export function formatStellarAmount(
  value: number | string | bigint,
  options: FormatStellarAmountOptions = {}
): string {
  const { inStroops = false, maxDecimals = 7, trimTrailingZeros = true } = options;

  if (typeof value === "number" && !Number.isFinite(value)) {
    return "—";
  }

  // Handle stroop-based amounts
  if (inStroops) {
    let stroopVal: bigint;
    try {
      stroopVal =
        typeof value === "bigint"
          ? value
          : BigInt(typeof value === "number" ? Math.trunc(value) : value.trim());
    } catch {
      return "—";
    }

    const isNegative = stroopVal < 0n;
    const absVal = isNegative ? -stroopVal : stroopVal;
    const whole = absVal / STROOPS_PER_XLM;
    const fractionPart = absVal % STROOPS_PER_XLM;

    let fracStr = fractionPart.toString().padStart(7, "0");
    if (maxDecimals < 7) {
      fracStr = fracStr.slice(0, maxDecimals);
    }
    if (trimTrailingZeros) {
      fracStr = fracStr.replace(/0+$/, "");
    }

    const result = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
    return isNegative ? `-${result}` : result;
  }

  // Handle direct token decimal amounts
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number") {
    if (value === 0) return "0";
    const str = value.toFixed(maxDecimals);
    return trimTrailingZeros ? str.replace(/\.?0+$/, "") : str;
  }

  const trimmed = value.trim();
  if (trimmed === "") return "—";

  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return "—";

  const sign = match[1] === "-" ? "-" : "";
  const integerPart = match[2];
  let decimalPart = match[3] ?? "";

  if (maxDecimals < decimalPart.length) {
    decimalPart = decimalPart.slice(0, maxDecimals);
  }
  if (trimTrailingZeros) {
    decimalPart = decimalPart.replace(/0+$/, "");
  }

  if (decimalPart.length > 0) {
    return `${sign}${integerPart}.${decimalPart}`;
  }
  return `${sign}${integerPart}`;
}
