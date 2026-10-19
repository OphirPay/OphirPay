"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value?: number; // 0–100 (required for determinate mode)
  max?: number;
  variant?: "default" | "success" | "warning" | "danger";
  showLabel?: boolean;
  /** Indeterminate mode for operations whose progress cannot be measured
   *  (e.g. parsing an uploaded CSV) — renders a pulsing bar without a value. */
  indeterminate?: boolean;
  className?: string;
}

const variantClasses = {
  default: "bg-ophir-500",
  success: "bg-green-500",
  warning: "bg-yellow-500",
  danger: "bg-red-500",
};

/**
 * Horizontal progress bar for batch payment progress, uploads, etc.
 */
export function ProgressBar({
  value = 0,
  max = 100,
  variant = "default",
  showLabel = false,
  indeterminate = false,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className={cn("w-full", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        aria-busy={indeterminate || undefined}
        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            variantClasses[variant],
            indeterminate && "animate-pulse w-2/5"
          )}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
      {showLabel && !indeterminate && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {Math.round(pct)}%
        </p>
      )}
    </div>
  );
}
