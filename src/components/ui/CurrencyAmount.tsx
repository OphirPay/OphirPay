"use client";
// SPDX-License-Identifier: MIT

import type { DisplayCurrency } from "@/hooks/useCurrencyDisplay";
import { formatAmount } from "@/lib/utils";
import { convertXlmToUsd, formatFiatAmount } from "@/lib/price";

export interface CurrencyAmountProps {
  /** Amount in the asset's base units (e.g. whole XLM, not stroops). */
  amount: number | string;
  /** Asset code — USD conversion is only supported for native XLM. */
  assetCode?: string;
  /** Persisted display preference. */
  currency: DisplayCurrency;
  /** XLM/USD spot price, or null while the feed is unavailable. */
  price: number | null;
  className?: string;
}

/** Asset codes that map to native XLM (and are therefore USD-convertible). */
const XLM_ASSET_CODES = new Set(["XLM", "native", ""]);

/**
 * Shared amount renderer honoring the persisted XLM ↔ USD display preference.
 *
 * - XLM mode (or a non-XLM asset): renders the asset unit explicitly.
 * - USD mode with a live price: fiat primary with the XLM amount as subtitle.
 * - USD mode without a price: falls back to the asset unit with a visible
 *   "(USD unavailable)" hint — never a stale or zero fiat value.
 */
export function CurrencyAmount({
  amount,
  assetCode = "XLM",
  currency,
  price,
  className,
}: CurrencyAmountProps) {
  const code = assetCode || "XLM";
  const parsed = typeof amount === "string" ? parseFloat(amount) : amount;
  const safeAmount = Number.isFinite(parsed) ? parsed : 0;
  const isXlm = XLM_ASSET_CODES.has(code);
  const usd =
    currency === "USD" && isXlm ? convertXlmToUsd(safeAmount, price) : null;

  if (usd === null) {
    return (
      <span className={className}>
        {formatAmount(safeAmount, code)}
        {currency === "USD" && isXlm && (
          <span className="block text-[11px] text-amber-600 dark:text-amber-400 font-sans">
            (USD unavailable)
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={className}>
      <span className="font-medium text-gray-900 dark:text-white">
        {formatFiatAmount(usd, { showApprox: true })}
      </span>
      <span className="block text-[11px] text-gray-400 dark:text-gray-500">
        {formatAmount(safeAmount, code)}
      </span>
    </span>
  );
}
