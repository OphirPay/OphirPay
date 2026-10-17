"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFeeSnapshot,
  type FeeSnapshot,
  type FeeStatsFetcher,
} from "@/lib/fee-stats";

/**
 * How often the recommended fee is refreshed, in milliseconds.
 *
 * Horizon's statistics are ledger-based; polling faster than a ledger close
 * (~5s) adds load without new information. Thirty seconds keeps the displayed
 * tiers current through a congestion window without turning every open send
 * tab into a Horizon poller.
 */
export const FEE_STATS_REFRESH_MS = 30_000;

export interface UseFeeStatsOptions {
  /** Poll interval in ms. Defaults to {@link FEE_STATS_REFRESH_MS}. */
  refreshMs?: number;
  /** Disable fetching (e.g. while the form is hidden). */
  enabled?: boolean;
  /** Injectable fetcher for tests; defaults to Horizon via `getFeeSnapshot`. */
  fetcher?: FeeStatsFetcher;
}

export interface UseFeeStatsResult {
  /** Latest tier snapshot, including provenance and congestion. */
  snapshot: FeeSnapshot | null;
  /** True only while the *first* sample is in flight. */
  isLoading: boolean;
  /** Unexpected failure (the shared loader normally degrades gracefully). */
  error: string | null;
  /** Force a refetch now (used by the refresh control). */
  refresh: () => Promise<void>;
}

/**
 * Live network fee statistics for the payment form (issue #1373).
 *
 * Delegates to `getFeeSnapshot`, which owns the TTL cache and the
 * Horizon → cached → configured-fallback ladder. That means this hook (and the
 * selector it feeds) can never block a payment: during a Horizon outage the
 * previous sample is shown with `stale: true`, and a cold start still yields
 * the protocol base fee.
 */
export function useFeeStats(
  options: UseFeeStatsOptions = {}
): UseFeeStatsResult {
  const { refreshMs = FEE_STATS_REFRESH_MS, enabled = true, fetcher } = options;

  const [snapshot, setSnapshot] = useState<FeeSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // Refs (not state) because they must not re-trigger the polling effect.
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // Only the first load shows a loading state; background refreshes keep the
    // current tiers on screen so the selected radio never flickers.
    if (!hasSnapshotRef.current) setIsLoading(true);

    try {
      // Always ask for a fresh sample: this hook is the UI's polling source,
      // and a cache hit here would double the effective refresh interval.
      const next = await getFeeSnapshot(fetcher, Date.now(), {
        forceRefresh: true,
      });
      if (!mountedRef.current) return;
      hasSnapshotRef.current = true;
      setSnapshot(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Fee statistics unavailable"
      );
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    void refresh();

    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [enabled, refresh, refreshMs]);

  return { snapshot, isLoading, error, refresh };
}
