"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from "react";
import {
  parseFeeStats,
  congestionFromCapacity,
  DEFAULT_FALLBACK_BASE_FEE,
  type RawFeeStats,
  type NetworkCongestion,
} from "@/lib/fee-stats";
import { HORIZON_URL, XLM_STROOPS } from "@/lib/stellar";

export const MIN_NETWORK_FEE_STROOPS = 100;
export const DEFAULT_FEE_POLL_INTERVAL_MS = 30_000;

export interface FeeTierQuote {
  stroops: number;
  xlm: string;
}

export interface FeeStatsSnapshot {
  baseFee: number;
  low: FeeTierQuote;
  recommended: FeeTierQuote;
  fast: FeeTierQuote;
  congestion: NetworkCongestion;
  ledgerCapacityUsage: number;
  stale: boolean;
  updatedAt: string;
}

/**
 * Convert stroops to a 7-decimal XLM string.
 */
export function stroopsToXlm(stroops: number): string {
  const safeStroops = Math.max(0, Number.isFinite(stroops) ? stroops : 0);
  return (safeStroops / XLM_STROOPS).toFixed(7);
}

/**
 * Build a normalized 3-tier quote (Low = p50, Recommended = p90, Fast = p99)
 * from raw Horizon `/fee_stats` data, floored at `MIN_NETWORK_FEE_STROOPS` (100).
 */
export function buildFeeStatsSnapshot(
  raw?: RawFeeStats | null,
  stale = false
): FeeStatsSnapshot {
  if (!raw) {
    const base = DEFAULT_FALLBACK_BASE_FEE;
    const rec = 200;
    const fast = 500;
    return {
      baseFee: base,
      low: { stroops: base, xlm: stroopsToXlm(base) },
      recommended: { stroops: rec, xlm: stroopsToXlm(rec) },
      fast: { stroops: fast, xlm: stroopsToXlm(fast) },
      congestion: "low",
      ledgerCapacityUsage: 0,
      stale: true,
      updatedAt: new Date().toISOString(),
    };
  }

  const parsed = parseFeeStats(raw);
  const baseFee = Math.max(MIN_NETWORK_FEE_STROOPS, parsed.baseFee);
  const lowStroops = Math.max(baseFee, Math.ceil(parsed.charged.p50));
  const recommendedStroops = Math.max(
    lowStroops,
    Math.ceil(parsed.charged.p90)
  );
  const fastStroops = Math.max(
    recommendedStroops,
    Math.ceil(parsed.charged.p99)
  );

  return {
    baseFee,
    low: { stroops: lowStroops, xlm: stroopsToXlm(lowStroops) },
    recommended: {
      stroops: recommendedStroops,
      xlm: stroopsToXlm(recommendedStroops),
    },
    fast: { stroops: fastStroops, xlm: stroopsToXlm(fastStroops) },
    congestion: congestionFromCapacity(parsed.ledgerCapacityUsage),
    ledgerCapacityUsage: parsed.ledgerCapacityUsage,
    stale,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchHorizonFeeStats(
  horizonUrl: string = HORIZON_URL
): Promise<RawFeeStats> {
  const cleanUrl = horizonUrl.replace(/\/$/, "");
  const res = await fetch(`${cleanUrl}/fee_stats`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Horizon /fee_stats returned HTTP ${res.status}`);
  }
  return (await res.json()) as RawFeeStats;
}

export interface UseFeeStatsOptions {
  pollIntervalMs?: number;
  fetcher?: () => Promise<RawFeeStats>;
  enabled?: boolean;
}

export function useFeeStats(options: UseFeeStatsOptions = {}) {
  const {
    pollIntervalMs = DEFAULT_FEE_POLL_INTERVAL_MS,
    fetcher = fetchHorizonFeeStats,
    enabled = true,
  } = options;

  const [stats, setStats] = useState<FeeStatsSnapshot>(() =>
    buildFeeStatsSnapshot(null, true)
  );
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await fetcher();
      setStats(buildFeeStatsSnapshot(raw, false));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch fee stats"
      );
      setStats((prev) => ({ ...prev, stale: true }));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    const tick = async () => {
      try {
        const raw = await fetcher();
        if (!active) return;
        setStats(buildFeeStatsSnapshot(raw, false));
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch fee stats"
        );
        setStats((prev) => ({ ...prev, stale: true }));
      } finally {
        if (active) setLoading(false);
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, pollIntervalMs);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [enabled, fetcher, pollIntervalMs]);

  return {
    stats,
    loading,
    error,
    refresh,
  };
}
