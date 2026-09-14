"use client";
// SPDX-License-Identifier: MIT

import { useCallback } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { STORAGE_KEYS } from "@/lib/storage-keys";

export type DisplayCurrency = "XLM" | "USD";

export interface UseCurrencyDisplayReturn {
  currency: DisplayCurrency;
  setCurrency: (currency: DisplayCurrency) => void;
  toggleCurrency: () => void;
  isXlm: boolean;
  isUsd: boolean;
}

/**
 * Hook for persisting and toggling currency display preference (XLM ↔ USD) in localStorage.
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

  return {
    currency,
    setCurrency,
    toggleCurrency,
    isXlm: currency === "XLM",
    isUsd: currency === "USD",
  };
}
