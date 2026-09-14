"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchXlmPrice, type PriceResult } from "@/lib/price";

export interface UseXlmPriceOptions {
  enabled?: boolean;
  pollInterval?: number; // in ms (0 = disabled)
  ttlMs?: number;
}

export interface UseXlmPriceReturn {
  price: number | null;
  source: PriceResult["source"];
  isLoading: boolean;
  isError: boolean;
  isUnavailable: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: (forceRefresh?: boolean) => Promise<PriceResult>;
}

/**
 * React hook to fetch and monitor the live XLM/USD spot price.
 */
export function useXlmPrice(options?: UseXlmPriceOptions): UseXlmPriceReturn {
  const enabled = options?.enabled ?? true;
  const pollInterval = options?.pollInterval ?? 0;
  const ttlMs = options?.ttlMs;

  const [price, setPrice] = useState<number | null>(null);
  const [source, setSource] = useState<PriceResult["source"]>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isMountedRef = useRef(true);

  const loadPrice = useCallback(
    async (forceRefresh = false): Promise<PriceResult> => {
      setIsLoading(true);
      try {
        const result = await fetchXlmPrice({ forceRefresh, ttlMs });
        if (isMountedRef.current) {
          setPrice(result.price);
          setSource(result.source);
          setError(result.error ?? null);
          if (result.price !== null) {
            setLastUpdated(result.timestamp ? new Date(result.timestamp) : new Date());
          }
          setIsLoading(false);
        }
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Failed to fetch price";
        if (isMountedRef.current) {
          setError(errMsg);
          setIsLoading(false);
        }
        return { price: null, source: null, error: errMsg };
      }
    },
    [ttlMs]
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) {
      loadPrice(false);
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [enabled, loadPrice]);

  useEffect(() => {
    if (!enabled || !pollInterval || pollInterval <= 0) return;
    const interval = setInterval(() => {
      loadPrice(true);
    }, pollInterval);
    return () => clearInterval(interval);
  }, [enabled, pollInterval, loadPrice]);

  return {
    price,
    source,
    isLoading,
    isError: error !== null && price === null,
    isUnavailable: price === null && !isLoading,
    error,
    lastUpdated,
    refetch: loadPrice,
  };
}
