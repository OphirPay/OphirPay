"use client";
// SPDX-License-Identifier: MIT

import React from "react";
import { cn } from "@/lib/utils";

export interface AmountProps {
  value: number | string;
  asset?: string;
  compact?: boolean;
  className?: string;
  showSign?: boolean;
}

export interface FormatAmountOptions {
  asset?: string;
  compact?: boolean;
  minDecimals?: number;
  maxDecimals?: number;
  showSign?: boolean;
}

export interface AmountValidationResult {
  valid: boolean;
  value?: number;
  error?: string;
  code?: "EMPTY" | "INVALID_FORMAT" | "NEGATIVE_NOT_ALLOWED" | "EXCESSIVE_DECIMALS" | "OUT_OF_RANGE";
}

/**
 * Format a number with compact notation for large values (e.g. 1.2M, 450K).
 */
export function formatCompact(num: number): string {
  if (!Number.isFinite(num)) return "—";
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(2);
}

/**
 * Strips all Unicode whitespace characters (non-breaking spaces, thin spaces, etc.)
 * and normalizes Unicode minus signs.
 */
export function normalizeAmountString(input: string): string {
  return input
    .replace(/\u2212/g, "-") // Unicode minus
    .replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, " ")
    .trim();
}

/**
 * Format a number, numeric string, or bigint for human display.
 * Avoids scientific / exponential notation, ensures consistent grouping,
 * and maintains precision up to 7 decimal places (Stellar maximum).
 */
export function formatAmount(
  value: number | string | bigint,
  assetOrOptions?: string | FormatAmountOptions
): string {
  const options: FormatAmountOptions =
    typeof assetOrOptions === "string"
      ? { asset: assetOrOptions }
      : (assetOrOptions ?? {});

  const {
    asset,
    compact = false,
    minDecimals = 2,
    maxDecimals = 7,
    showSign = false,
  } = options;

  let num: number;
  if (typeof value === "bigint") {
    num = Number(value);
  } else if (typeof value === "string") {
    const parsed = parseAmount(value);
    if (parsed === null) return "—";
    num = parsed;
  } else {
    num = value;
  }

  if (!Number.isFinite(num)) {
    return "—";
  }

  if (compact) {
    const formattedCompact = formatCompact(num);
    const signPrefix = showSign && num > 0 ? "+" : "";
    return asset ? `${signPrefix}${formattedCompact} ${asset}` : `${signPrefix}${formattedCompact}`;
  }

  const absNum = Math.abs(num);
  // Format to maxDecimals without exponential notation
  const fixedStr = absNum.toFixed(maxDecimals);
  const [intPartRaw, fracPartRaw] = fixedStr.split(".");
  const intFormatted = new Intl.NumberFormat("en-US", { useGrouping: true }).format(BigInt(intPartRaw));

  let fracPart = fracPartRaw || "";
  while (fracPart.length > minDecimals && fracPart.endsWith("0")) {
    fracPart = fracPart.slice(0, -1);
  }

  const sign = num < 0 ? "-" : showSign && num > 0 ? "+" : "";
  const numFormatted = fracPart.length > 0 ? `${sign}${intFormatted}.${fracPart}` : `${sign}${intFormatted}`;

  return asset && asset.length > 0 ? `${numFormatted} ${asset}` : numFormatted;
}

/**
 * Parses any human-readable or formatted currency string back into a numeric value.
 * Handles grouping commas, periods, spaces, currency symbols/codes, and Unicode formatting.
 * Returns null gracefully for invalid inputs without throwing unhandled exceptions.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") return null;

  let s = normalizeAmountString(input);
  if (!s) return null;

  // Detect sign
  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Remove common currency symbols: $, €, £, ¥, etc.
  s = s.replace(/^[\$€£¥₹₽\s]+|[\$€£¥₹₽\s]+$/g, "").trim();

  // Strip leading or trailing asset codes (must start with letter and have whitespace separation)
  s = s.replace(/^[A-Za-z][A-Za-z0-9_]{1,11}\s+/, "").trim();
  s = s.replace(/\s+[A-Za-z][A-Za-z0-9_]{1,11}$/, "").trim();

  // Collapse whitespace between digits (e.g. French / Unicode thousand grouping "1 234.56" -> "1234.56")
  s = s.replace(/(\d)\s+(\d)/g, "$1$2");

  // Check for scientific / exponential notation (e.g. 1e-4, 2.5e3)
  if (/^[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+$/.test(s)) {
    const val = Number(s) * sign;
    return Number.isFinite(val) ? val : null;
  }

  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;

  if (dotCount > 1 && commaCount === 0) {
    // Only multiple dots: valid if strictly standard 3-digit thousand grouping e.g. "1.000.000"
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    } else {
      return null;
    }
  } else if (commaCount > 1 && dotCount === 0) {
    // Only multiple commas: valid if strictly standard 3-digit thousand grouping e.g. "1,000,000"
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, "");
    } else {
      return null;
    }
  } else if (dotCount > 0 && commaCount > 0) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // 1.234,56 -> dot is grouping, comma is decimal
      const intPart = s.slice(0, lastComma);
      const fracPart = s.slice(lastComma + 1);
      if (intPart.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) {
        return null;
      }
      if (!/^\d+$/.test(fracPart)) {
        return null;
      }
      s = `${intPart.replace(/\./g, "")}.${fracPart}`;
    } else {
      // 1,234.56 -> comma is grouping, dot is decimal
      const intPart = s.slice(0, lastDot);
      const fracPart = s.slice(lastDot + 1);
      if (intPart.includes(",") && !/^\d{1,3}(,\d{3})+$/.test(intPart)) {
        return null;
      }
      if (!/^\d+$/.test(fracPart)) {
        return null;
      }
      s = `${intPart.replace(/,/g, "")}.${fracPart}`;
    }
  } else if (commaCount === 1) {
    // Single comma: e.g. 1,234 or 12,50
    const parts = s.split(",");
    if (parts[1].length !== 3) {
      // Decimal comma (e.g. 12,50)
      s = `${parts[0]}.${parts[1]}`;
    } else if (parts[0].length <= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      // 1,234 -> grouping
      s = `${parts[0]}${parts[1]}`;
    } else {
      s = `${parts[0]}.${parts[1]}`;
    }
  }

  // Remove any remaining whitespace
  s = s.replace(/\s+/g, "");

  // Must strictly match digits, optionally followed by decimal point and digits
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return null;
  }

  const num = parseFloat(s) * sign;
  return Number.isFinite(num) ? num : null;
}

/**
 * Validates an amount string with detailed error feedback.
 */
export function validateAmount(
  input: string | number | null | undefined,
  options?: {
    allowNegative?: boolean;
    maxDecimals?: number;
    min?: number;
    max?: number;
  }
): AmountValidationResult {
  const {
    allowNegative = false,
    maxDecimals = 7,
    min,
    max,
  } = options ?? {};

  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return { valid: false, error: "Amount is required", code: "EMPTY" };
  }

  const parsed = parseAmount(input);
  if (parsed === null) {
    return { valid: false, error: "Invalid amount format", code: "INVALID_FORMAT" };
  }

  if (!allowNegative && parsed < 0) {
    return { valid: false, error: "Amount cannot be negative", code: "NEGATIVE_NOT_ALLOWED" };
  }

  if (typeof input === "string") {
    const normalized = normalizeAmountString(input);
    const decimalMatch = /[.,](\d+)$/.exec(normalized.replace(/[A-Za-z\s$€£¥]+$/, ""));
    if (decimalMatch && decimalMatch[1].length > maxDecimals) {
      return {
        valid: false,
        error: `Amount exceeds maximum precision of ${maxDecimals} decimal places`,
        code: "EXCESSIVE_DECIMALS",
      };
    }
  }

  if (min !== undefined && parsed < min) {
    return { valid: false, error: `Amount must be at least ${min}`, code: "OUT_OF_RANGE" };
  }

  if (max !== undefined && parsed > max) {
    return { valid: false, error: `Amount must be at most ${max}`, code: "OUT_OF_RANGE" };
  }

  return { valid: true, value: parsed };
}

/**
 * Consistent amount display component for payment values.
 * Shows sign (+/-), compact formatting, and asset code.
 */
export function Amount({
  value,
  asset = "XLM",
  compact = false,
  className,
  showSign = false,
}: AmountProps) {
  const num = typeof value === "string" ? parseAmount(value) : value;

  if (num === null || !Number.isFinite(num)) {
    return <span className={cn("text-gray-400", className)}>—</span>;
  }

  const formatted = formatAmount(num, { asset: "", compact, minDecimals: 2, maxDecimals: 7 });
  const sign = showSign && num > 0 ? "+" : num < 0 ? "−" : "";

  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        num > 0 ? "text-green-600 dark:text-green-400" : num < 0 ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300",
        className
      )}
    >
      {sign}
      {formatted} {asset}
    </span>
  );
}
