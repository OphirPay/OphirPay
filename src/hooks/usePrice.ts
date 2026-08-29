"use client";
// SPDX-License-Identifier: MIT

import { useApiQuery } from "@/hooks/useApiQuery";
import { fetchXlmPrice, type PriceSource } from "@/lib/price";

/**
 * Hook to retrieve the current XLM/USD price source with automatic caching
 * and graceful fallback on error.
 */
export function usePrice() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<PriceSource>(
    ["price", "xlm-usd"],
    undefined,
    {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
    () => fetchXlmPrice()
  );

  return {
    priceData: data ?? null,
    priceRate: data?.xlmUsd ?? null,
    isLoading,
    isError,
    error: error ? error.message : (data?.error ?? null),
    refetch,
  };
}
