"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";

interface AmountProps {
  value: number | string;
  asset?: string;
  compact?: boolean;
  className?: string;
  showSign?: boolean;
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
  const num = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(num)) return <span className={cn("text-gray-400", className)}>—</span>;

  const formatted = compact
    ? formatCompact(num)
    : num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 7,
      });

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

function formatCompact(num: number): string {
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(2);
}
