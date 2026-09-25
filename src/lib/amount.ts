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

/** `toFixed` returns exponential notation for magnitudes at or above this. */
const TO_FIXED_EXPONENTIAL_LIMIT = 1e21;

export type DecimalRoundingMode = "halfExpand" | "halfEven";

export interface FormatDecimalOptions {
  roundingMode?: DecimalRoundingMode;
}

/** Strip the padding `toFixed` adds, without losing small magnitudes. */
function trimTrailingZeros(fixed: string): string {
  if (!fixed.includes(".")) return fixed === "-0" ? "0" : fixed;
  const stripped = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return stripped === "-0" || stripped === "" ? "0" : stripped;
}

/** Format a number with compact notation for large values (e.g., 1.2M, 450K). */
export function formatCompactAmount(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return NON_FINITE_AMOUNT;
  const safeValue = value === 0 ? 0 : value;
  if (Math.abs(safeValue) >= 1e9) return `${(safeValue / 1e9).toFixed(decimals)}B`;
  if (Math.abs(safeValue) >= 1e6) return `${(safeValue / 1e6).toFixed(decimals)}M`;
  if (Math.abs(safeValue) >= 1e3) return `${(safeValue / 1e3).toFixed(decimals)}K`;
  const fixed = safeValue.toFixed(decimals);
  return fixed === "-0.00" || fixed === "-0" ? (0).toFixed(decimals) : fixed;
}

/** Format stroops to a clean XLM display (e.g., 12500000 → "12.50"). */
export function stroopsToDisplay(
  stroops: number,
  maxDecimals = 7,
  options?: FormatDecimalOptions | DecimalRoundingMode
): string {
  if (!Number.isFinite(stroops)) return NON_FINITE_AMOUNT;
  return formatDecimal(stroops / 1e7, maxDecimals, options);
}

interface ExtendedNumberFormatOptions extends Intl.NumberFormatOptions {
  roundingMode?: string;
}

/** Pad a number to a fixed number of decimal places with trailing zeros removed. */
export function formatDecimal(
  value: number,
  maxDecimals = 7,
  options?: FormatDecimalOptions | DecimalRoundingMode
): string {
  if (!Number.isFinite(value)) return NON_FINITE_AMOUNT;

  const mode = typeof options === "string" ? options : options?.roundingMode;
  if (mode === "halfEven") {
    const intlOptions: ExtendedNumberFormatOptions = {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
      roundingMode: "halfEven",
      useGrouping: false,
    };
    const formatted = new Intl.NumberFormat("en-US", intlOptions as Intl.NumberFormatOptions).format(value);
    return formatted === "-0" ? "0" : formatted;
  }

  const fixed = value.toFixed(maxDecimals);
  if (Math.abs(value) >= TO_FIXED_EXPONENTIAL_LIMIT) {
    const intlOptions: ExtendedNumberFormatOptions = {
      maximumFractionDigits: maxDecimals,
      useGrouping: false,
    };
    return new Intl.NumberFormat("en-US", intlOptions as Intl.NumberFormatOptions).format(value);
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

