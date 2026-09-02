"use client";
// SPDX-License-Identifier: MIT

import type { DisplayCurrency } from "@/hooks/useCurrencyDisplay";
import { cn } from "@/lib/utils";

export interface CurrencyToggleProps {
  value: DisplayCurrency;
  onChange: (value: DisplayCurrency) => void;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  showPrice?: boolean;
  price?: number | null;
  isUnavailable?: boolean;
}

/**
 * Accessible segmented toggle button group for switching between XLM and USD fiat display.
 */
export function CurrencyToggle({
  value,
  onChange,
  className,
  disabled = false,
  size = "md",
  showPrice = false,
  price,
  isUnavailable = false,
}: CurrencyToggleProps) {
  const isSm = size === "sm";

  return (
    <div
      role="group"
      aria-label="Currency display toggle"
      className={cn(
        "inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-800/80 p-0.5 border border-gray-200 dark:border-gray-700 select-none",
        disabled && "opacity-50 pointer-events-none cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="button"
        aria-pressed={value === "XLM"}
        aria-label="Display amounts in XLM"
        disabled={disabled}
        onClick={() => onChange("XLM")}
        className={cn(
          "rounded-md font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500",
          isSm ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs font-semibold sm:text-sm",
          value === "XLM"
            ? "bg-white dark:bg-gray-900 text-ophir-600 dark:text-ophir-400 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
        )}
      >
        XLM
      </button>

      <button
        type="button"
        role="button"
        aria-pressed={value === "USD"}
        aria-label="Display amounts in USD"
        disabled={disabled}
        onClick={() => onChange("USD")}
        className={cn(
          "rounded-md font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ophir-500 flex items-center gap-1",
          isSm ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs font-semibold sm:text-sm",
          value === "USD"
            ? "bg-white dark:bg-gray-900 text-ophir-600 dark:text-ophir-400 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
        )}
      >
        USD
        {showPrice && price !== null && price !== undefined && (
          <span className="hidden sm:inline text-[10px] font-mono opacity-75">
            (${price.toFixed(2)})
          </span>
        )}
        {showPrice && isUnavailable && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
            title="Price feed unavailable"
            aria-label="Price feed unavailable"
          />
        )}
      </button>
    </div>
  );
}
