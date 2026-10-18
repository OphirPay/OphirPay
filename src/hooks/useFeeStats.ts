// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import {
  defaultFeeStatsFetcher,
  parseFeeStats,
  congestionFromCapacity,
  type NetworkCongestion,
} from "@/lib/fee-stats";

export interface FeeTierDetails {
  stroops: number;
  xlm: string;
  label: string;
  estimatedWait: string;
}

export interface FeeStatsState {
  baseFee: number;
  low: FeeTierDetails;
  recommended: FeeTierDetails;
  fast: FeeTierDetails;
  congestion: NetworkCongestion;
  capacityUsage: number;
  lastUpdated: Date | null;
}

export interface UseFeeStatsOptions {
  /** Polling interval in ms (default: 30,000ms / 30 seconds). */
  pollIntervalMs?: number;
  /** Whether auto-refresh polling is enabled (default: true). */
  enabled?: boolean;
}

export const STROOPS_PER_XLM = 10_000_000;

export function stroopsToXlm(stroops: number): string {
  const val = stroops / STROOPS_PER_XLM;
  // Format with up to 7 decimal places, trimming trailing zeros
  return val.toFixed(7).replace(/\.?0+$/, "");
}

const DEFAULT_STATE: FeeStatsState = {
  baseFee: 100,
  low: {
    stroops: 100,
    xlm: "0.00001",
    label: "Low",
    estimatedWait: "~1-2 ledgers (10-15s)",
  },
  recommended: {
    stroops: 150,
    xlm: "0.000015",
    label: "Recommended",
    estimatedWait: "Next ledger (<5s)",
  },
  fast: {
    stroops: 300,
    xlm: "0.00003",
    label: "Fast",
    estimatedWait: "Immediate inclusion (<3s)",
  },
  congestion: "low",
  capacityUsage: 0.1,
  lastUpdated: null,
};

/**
 * Custom React hook that fetches Horizon /fee_stats and provides dynamic fee estimates.
 * Polls smoothly every 30 seconds by default (Issue #1373).
 */
export function useFeeStats(options: UseFeeStatsOptions = {}) {
  const { pollIntervalMs = 30_000, enabled = true } = options;

  const [feeStats, setFeeStats] = useState<FeeStatsState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const isMountedRef = useRef(true);

  const fetchStats = useCallback(async () => {
    try {
      const raw = await defaultFeeStatsFetcher();
      const parsed = parseFeeStats(raw);

      const baseFee = Math.max(100, parsed.baseFee || 100);
      const p50 = parsed.charged.p50 || baseFee;
      const p90 = parsed.charged.p90 || Math.round(baseFee * 1.5);
      const p99 = parsed.charged.p99 || Math.max(parsed.charged.max, baseFee * 3);

      const lowStroops = Math.max(baseFee, p50);
      const recommendedStroops = Math.max(lowStroops, p90);
      const fastStroops = Math.max(recommendedStroops + 50, p99);

      const congestion = congestionFromCapacity(parsed.ledgerCapacityUsage);

      if (isMountedRef.current) {
        setFeeStats({
          baseFee,
          low: {
            stroops: lowStroops,
            xlm: stroopsToXlm(lowStroops),
            label: "Low",
            estimatedWait: "~1-2 ledgers (10-15s)",
          },
          recommended: {
            stroops: recommendedStroops,
            xlm: stroopsToXlm(recommendedStroops),
            label: "Recommended",
            estimatedWait: "Next ledger (<5s)",
          },
          fast: {
            stroops: fastStroops,
            xlm: stroopsToXlm(fastStroops),
            label: "Fast",
            estimatedWait: "Immediate inclusion (<3s)",
          },
          congestion,
          capacityUsage: parsed.ledgerCapacityUsage,
          lastUpdated: new Date(),
        });
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error("Failed to fetch Horizon fee stats"));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchStats();

    if (!enabled || pollIntervalMs <= 0) return;

    const timer = setInterval(() => {
      void fetchStats();
    }, pollIntervalMs);

    return () => {
      isMountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchStats, enabled, pollIntervalMs]);

  return {
    feeStats,
    isLoading,
    error,
    refresh: fetchStats,
  };
}

export default useFeeStats;
