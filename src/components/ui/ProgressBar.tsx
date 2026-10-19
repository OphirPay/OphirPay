"use client";
// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";

export interface ProgressBarProps {
  value: number; // 0–100
  max?: number;
  variant?: "default" | "success" | "warning" | "danger";
  showLabel?: boolean;
  label?: string;
  className?: string;
  "data-testid"?: string;
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
  value,
  max = 100,
  variant = "default",
  showLabel = false,
  label,
  className,
  "data-testid": testId,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className={cn("w-full", className)} data-testid={testId}>
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ?? "Upload progress"}
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            variantClasses[variant]
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(showLabel || label) && (
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          {label && <span>{label}</span>}
          {showLabel && <span>{Math.round(pct)}%</span>}
        </div>
      )}
    </div>
  );
}
