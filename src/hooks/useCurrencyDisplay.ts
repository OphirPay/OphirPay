"use client";
// SPDX-License-Identifier: MIT

import { useCallback } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import {
  formatAmount,
  parseAmount,
  validateAmount,
  type FormatAmountOptions,
  type AmountValidationResult,
} from "@/components/ui/Amount";

export type DisplayCurrency = "XLM" | "USD";

export interface UseCurrencyDisplayReturn {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
  toggleCurrency: () => void;
  isXlm: boolean;
  isUsd: boolean;
  formatAmount: (value: number | string, options?: FormatAmountOptions) => string;
  parseAmount: (value: string) => number | null;
  validateAmount: (value: string) => AmountValidationResult;
}

export { formatAmount, parseAmount, validateAmount, type FormatAmountOptions, type AmountValidationResult };

/**
 * Hook for persisting and toggling currency display preference (XLM ↔ USD) in localStorage.
 * Integrates robust amount formatting and parsing helpers.
 */
export function useCurrencyDisplay(
  defaultCurrency: DisplayCurrency = "XLM"
): UseCurrencyDisplayReturn {
  const [storedCurrency, setCurrency] = useLocalStorage<DisplayCurrency>(
    STORAGE_KEYS.CURRENCY_DISPLAY,
    defaultCurrency
  );

  const currency: DisplayCurrency =
    storedCurrency === "XLM" || storedCurrency === "USD" ? storedCurrency : defaultCurrency;

  const toggleCurrency = useCallback(() => {
    setCurrency((prev) => {
      const current = prev === "XLM" || prev === "USD" ? prev : defaultCurrency;
      return current === "XLM" ? "USD" : "XLM";
    });
  }, [setCurrency, defaultCurrency]);

  const formatWithCurrentCurrency = useCallback(
    (value: number | string, options?: FormatAmountOptions) => {
      return formatAmount(value, {
        asset: options?.asset ?? currency,
        ...options,
      });
    },
    [currency]
  );

  return {
    currency,
    setCurrency,
    toggleCurrency,
    isXlm: currency === "XLM",
    isUsd: currency === "USD",
    formatAmount: formatWithCurrentCurrency,
    parseAmount,
    validateAmount,
  };
}
