"use client";
// SPDX-License-Identifier: MIT

import type { DisplayCurrency } from "@/hooks/useCurrencyDisplay";
import { convertXlmToUsd, formatFiatAmount } from "@/lib/price";
import { formatAmount } from "@/lib/utils";

export interface CurrencyAmountProps {
  /** The amount in standard numerical unit (e.g. 10 for 10 XLM) */
  amount: number;
  /** The asset code (defaults to XLM) */
  assetCode?: string;
  /** Active display currency mode (XLM or USD) */
  currency: DisplayCurrency;
  /** Spot price of XLM in USD, or null if loading/unavailable */
  price: number | null;
  /** Whether the price feed is confirmed unavailable */
  isUnavailable?: boolean;
  /** Optional layout style: 'inline' or 'stacked' (stacked shows converted + subtitle) */
  layout?: "stacked" | "inline";
  /** Optional custom CSS classes for the primary amount text */
  className?: string;
  /** Optional custom CSS classes for the secondary subtitle text */
  subtitleClassName?: string;
}

/**
 * Shared currency amount display component.
 * Respects persisted currency preference (XLM <-> USD).
 * When in USD mode and asset is XLM:
 * - If price is available: renders USD amount with approx prefix (~$X.XX) and XLM subtext.
 * - If price is unavailable: renders raw XLM amount with an explicit (USD unavailable) warning.
 * For non-XLM assets (or when in XLM mode): renders formatted asset amount directly.
 */
export function CurrencyAmount({
  amount,
  assetCode = "XLM",
  currency,
  price,
  isUnavailable: _isUnavailable = false,
  layout = "stacked",
  className,
  subtitleClassName,
}: CurrencyAmountProps) {
  const isXlm = !assetCode || assetCode.toUpperCase() === "XLM";

  // Non-XLM assets or XLM mode: display standard formatted amount
  if (!isXlm || currency !== "USD") {
    return <span className={className}>{formatAmount(amount, assetCode)}</span>;
  }

  // USD mode with valid spot price
  if (price !== null && price > 0) {
    const usd = convertXlmToUsd(amount, price);
    const fiatStr = formatFiatAmount(usd, { showApprox: true });

    if (layout === "inline") {
      return (
        <span className={className}>
          <span>{fiatStr}</span>{" "}
          <span className={subtitleClassName ?? "text-xs text-gray-400 dark:text-gray-500 font-normal"}>
            ({formatAmount(amount, "XLM")})
          </span>
        </span>
      );
    }

    return (
      <div className="inline-block">
        <span className={className ?? "font-medium text-gray-900 dark:text-white"}>
          {fiatStr}
        </span>
        <span className={subtitleClassName ?? "block text-[11px] text-gray-400 dark:text-gray-500 font-normal"}>
          {formatAmount(amount, "XLM")}
        </span>
      </div>
    );
  }

  // USD mode with unavailable/stale price fallback
  if (layout === "inline") {
    return (
      <span className={className}>
        <span>{formatAmount(amount, "XLM")}</span>{" "}
        <span className={subtitleClassName ?? "text-xs text-amber-600 dark:text-amber-400 font-normal font-sans"}>
          (USD unavailable)
        </span>
      </span>
    );
  }

  return (
    <div className="inline-block">
      <span className={className}>{formatAmount(amount, "XLM")}</span>
      <span className={subtitleClassName ?? "block text-[11px] text-amber-600 dark:text-amber-400 font-normal font-sans"}>
        (USD unavailable)
      </span>
    </div>
  );
}
