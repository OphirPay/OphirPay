"use client";
// SPDX-License-Identifier: MIT

import type { DisplayCurrency } from "@/hooks/useCurrencyDisplay";
import { convertXlmToUsd, formatFiatAmount } from "@/lib/price";
import { formatAmount } from "@/lib/utils";

export interface ConvertedAmountProps {
  /** Value in XLM (or stroops-converted) units. */
  xlmValue: number;
  /**
   * Asset of the value. Non-XLM assets have no fiat price available, so they
   * always render in their own unit explicitly (never a stale $0.00).
   */
  assetCode?: string;
  className?: string;
  /**
   * Page-level preference + price. Passed as props (not hooks) on purpose:
   * useLocalStorage state is per-hook-instance, so a shared child reading
   * the preference itself would go stale when the page toggle updates.
   * Callers already hold both for their CurrencyToggle (see payments page).
   */
  currency: DisplayCurrency;
  xlmPrice: number | null;
}

/**
 * Amount renderer honoring the persisted currency preference (issue #795).
 * Mirrors the payments-table treatment: fiat primary with the XLM value as
 * a subline, explicit "(USD unavailable)" fallback when the price is missing.
 */
export function ConvertedAmount({
  xlmValue,
  assetCode = "XLM",
  className,
  currency,
  xlmPrice,
}: ConvertedAmountProps) {
  const isXlm = assetCode === "XLM" || assetCode === "native";
  if (currency !== "USD" || !isXlm) {
    return <span className={className}>{formatAmount(xlmValue, assetCode)}</span>;
  }
  if (xlmPrice !== null) {
    return (
      <span className={className}>
        <span className="font-medium text-gray-900 dark:text-white">
          {formatFiatAmount(convertXlmToUsd(xlmValue, xlmPrice), { showApprox: true })}
        </span>{" "}
        <span className="block text-[11px] text-gray-400 dark:text-gray-500">
          {formatAmount(xlmValue, "XLM")}
        </span>
      </span>
    );
  }
  return (
    <span className={className}>
      <span>{formatAmount(xlmValue, "XLM")}</span>{" "}
      <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-sans">
        (USD unavailable)
      </span>
    </span>
  );
}
