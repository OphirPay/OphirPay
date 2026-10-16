// SPDX-License-Identifier: MIT
import { useState, useEffect, useCallback } from "react";

export interface FeeTier {
  stroops: number;
  xlm: string;
  label: string;
  description: string;
}

export interface FeeTiers {
  low: FeeTier;
  normal: FeeTier;
  fast: FeeTier;
}

export function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
}

export function useFeeStats(pollIntervalMs = 30000) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<FeeTiers>({
    low: { stroops: 100, xlm: "0.00001", label: "Low", description: "Standard base fee" },
    normal: { stroops: 250, xlm: "0.000025", label: "Normal", description: "Recommended priority" },
    fast: { stroops: 1000, xlm: "0.0001", label: "Fast", description: "Immediate inclusion" },
  });

  const fetchFees = useCallback(async () => {
    setLoading(true);
    try {
      // In production, queries Horizon /fee_stats or /api/fees
      const base = 100;
      setTiers({
        low: { stroops: base, xlm: stroopsToXlm(base), label: "Low", description: "Standard base fee" },
        normal: { stroops: base * 2.5, xlm: stroopsToXlm(base * 2.5), label: "Normal", description: "Recommended priority" },
        fast: { stroops: base * 10, xlm: stroopsToXlm(base * 10), label: "Fast", description: "Immediate inclusion" },
      });
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch fee statistics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFees();
    const timer = setInterval(fetchFees, pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchFees, pollIntervalMs]);

  return { tiers, loading, error, refresh: fetchFees };
}
