"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchXlmPrice,
  getPriceStaleAfterMs,
  isPriceStale,
  type PriceResult,
} from "@/lib/price";

export interface UseXlmPriceOptions {
  enabled?: boolean;
  pollInterval?: number; // in ms (0 = disabled)
  ttlMs?: number;
  /** Age (ms) beyond which the price is stale and hidden. Defaults to `PRICE_STALE_AFTER_MS`. */
  staleAfterMs?: number;
}

export interface UseXlmPriceReturn {
  /** Fresh price only: `null` when unavailable or older than the stale threshold. */
  price: number | null;
  /** Last known price even if stale — for diagnostics, never for display as a current value. */
  lastKnownPrice: number | null;
  /** True when a price was observed but is older than the stale threshold. */
  isStale: boolean;
  /** Observation timestamp (epoch ms) of the last known price. */
  observedAt: number | null;
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
  const staleAfterMs = options?.staleAfterMs ?? getPriceStaleAfterMs();

  const [lastKnownPrice, setPrice] = useState<number | null>(null);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const [, setStaleTick] = useState(0);
  const [source, setSource] = useState<PriceResult["source"]>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isMountedRef = useRef(true);

  const loadPrice = useCallback(
    async (forceRefresh = false): Promise<PriceResult> => {
      setIsLoading(true);
      try {
        const result = await fetchXlmPrice({ forceRefresh, ttlMs, staleAfterMs });
        if (isMountedRef.current) {
          setPrice(result.price);
          setSource(result.source);
          setError(result.error ?? null);
          if (result.price !== null) {
            const observed = result.timestamp ?? Date.now();
            setObservedAt(observed);
            setLastUpdated(new Date(observed));
          } else {
            setObservedAt(null);
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
    [ttlMs, staleAfterMs]
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
    // Cache-respecting: a poll inside the TTL is a cache hit, not an upstream call.
    const interval = setInterval(() => {
      loadPrice(false);
    }, pollInterval);
    return () => clearInterval(interval);
  }, [enabled, pollInterval, loadPrice]);

  // Re-render the moment the observation crosses the threshold, so a value
  // that was fresh on arrival is hidden without waiting for another fetch.
  useEffect(() => {
    if (observedAt === null) return;
    const remaining = observedAt + staleAfterMs - Date.now();
    if (remaining < 0) return;
    const timer = setTimeout(() => setStaleTick((n) => n + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [observedAt, staleAfterMs]);

  const isStale =
    lastKnownPrice !== null && observedAt !== null && isPriceStale(observedAt, staleAfterMs);
  const price = isStale ? null : lastKnownPrice;

  return {
    price,
    lastKnownPrice,
    isStale,
    observedAt,
    source,
    isLoading,
    isError: error !== null && price === null,
    isUnavailable: price === null && !isLoading,
    error,
    lastUpdated,
    refetch: loadPrice,
  };
}
