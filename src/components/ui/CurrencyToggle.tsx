"use client";
// SPDX-License-Identifier: MIT

import { type CurrencyDisplay } from "@/lib/price";
import { cn } from "@/lib/utils";

export interface CurrencyToggleProps {
  value: CurrencyDisplay;
  onChange: (value: CurrencyDisplay) => void;
  disabled?: boolean;
  className?: string;
  priceRate?: number | null;
}

/**
 * Accessible toggle control for switching between XLM and USD display modes.
 */
export function CurrencyToggle({
  value,
  onChange,
  disabled = false,
  className,
  priceRate,
}: CurrencyToggleProps) {
  return (
    <div
      role="group"
      aria-label="Currency display toggle"
      className={cn(
        "inline-flex items-center p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/80 text-xs font-medium transition-colors",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "XLM"}
        aria-label="Display in XLM"
        disabled={disabled}
        onClick={() => onChange("XLM")}
        className={cn(
          "px-2.5 py-1 rounded-md transition-all font-medium focus:outline-none focus:ring-2 focus:ring-ophir-500",
          value === "XLM"
            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs font-semibold"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        )}
      >
        XLM
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={value === "USD"}
        aria-label="Display in USD"
        disabled={disabled}
        onClick={() => onChange("USD")}
        title={
          priceRate && priceRate > 0
            ? `1 XLM ≈ $${priceRate.toFixed(4)}`
            : "Fiat display mode"
        }
        className={cn(
          "px-2.5 py-1 rounded-md transition-all font-medium focus:outline-none focus:ring-2 focus:ring-ophir-500",
          value === "USD"
            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs font-semibold"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        )}
      >
        USD
      </button>
    </div>
  );
}
