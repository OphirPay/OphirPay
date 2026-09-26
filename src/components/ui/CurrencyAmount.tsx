"use client";
// SPDX-License-Identifier: MIT

import type { DisplayCurrency } from "@/hooks/useCurrencyDisplay";
import { convertXlmToUsd, formatFiatAmount } from "@/lib/price";
import { formatAmount } from "@/lib/utils";
import { cn } from "@/lib/utils";

export interface CurrencyAmountProps {
  /** Numeric amount in asset units (e.g. 10.5 for 10.5 XLM) */
  amount: number | string;
  /** Asset code, defaults to "XLM" */
  assetCode?: string;
  /** Active display currency preference: "XLM" | "USD" */
  currency: DisplayCurrency;
  /** Current XLM/USD exchange rate from price feed */
  price: number | null | undefined;
  /** Whether the price feed is currently unavailable or offline */
  isUnavailable?: boolean;
  /** Whether to render original asset amount as subtitle when in USD mode */
  showOriginal?: boolean;
  /** Custom class name for wrapper */
  className?: string;
  /** Custom class name for primary amount text */
  amountClassName?: string;
}

/**
 * Shared currency-aware amount display component.
 * Respects persisted currency preference (XLM ↔ USD), applies documented
 * financial rounding rules, and falls back visibly to asset units when
 * a price is missing or unavailable.
 */
export function CurrencyAmount({
  amount,
  assetCode = "XLM",
  currency,
  price,
  isUnavailable = false,
  showOriginal = true,
  className,
  amountClassName,
}: CurrencyAmountProps) {
  const numericAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numericAmount)) {
    return <span className={cn("text-gray-400", className)}>—</span>;
  }

  const effectiveAsset = assetCode === "native" ? "XLM" : assetCode.toUpperCase();
  const isXlmOrNative = effectiveAsset === "XLM";

  // XLM mode or non-convertible asset: render raw asset amount
  if (currency !== "USD" || !isXlmOrNative) {
    return (
      <span className={cn("font-mono", amountClassName, className)}>
        {formatAmount(numericAmount, effectiveAsset)}
      </span>
    );
  }

  // USD mode with valid price: render converted fiat amount + optional original subtitle
  if (price !== null && price !== undefined && !isNaN(price) && price > 0 && !isUnavailable) {
    const usdValue = convertXlmToUsd(numericAmount, price);
    return (
      <div className={cn("inline-block", className)}>
        <span className={cn("font-medium text-gray-900 dark:text-white", amountClassName)}>
          {formatFiatAmount(usdValue, { showApprox: true })}
        </span>
        {showOriginal && (
          <span className="block text-[11px] text-gray-400 dark:text-gray-500 font-mono">
            {formatAmount(numericAmount, "XLM")}
          </span>
        )}
      </div>
    );
  }

  // USD mode with unavailable/missing price: fall back visibly to asset unit
  return (
    <div className={cn("inline-block", className)}>
      <span className={cn("font-mono text-gray-900 dark:text-white", amountClassName)}>
        {formatAmount(numericAmount, "XLM")}
      </span>
      <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-sans">
        (USD unavailable)
      </span>
    </div>
  );
}
