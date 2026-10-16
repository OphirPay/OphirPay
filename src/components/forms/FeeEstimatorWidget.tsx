"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { estimateTransactionFee, type FeeEstimate } from "@/lib/fee-estimator";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";

// ── Types ──────────────────────────────────────────────────────

export interface FeeEstimatorWidgetProps {
  /** Number of operations in the transaction (default: 1) */
  operations?: number;
  /** Auto-refresh interval in ms (default: 30000). Set to 0 to disable. */
  refreshIntervalMs?: number;
  /** Show the refresh button (default: true) */
  showRefresh?: boolean;
  /** Show the fee basis / explanation text (default: true) */
  showBasis?: boolean;
  /** Show the staleness warning (default: true) */
  showStaleWarning?: boolean;
  /** Additional CSS class for the container */
  className?: string;
  /** Callback when a new estimate is received */
  onEstimateChange?: (estimate: FeeEstimate) => void;
  /** Test ID prefix for the widget elements */
  testIdPrefix?: string;
}

type CongestionLevel = FeeEstimate["networkCongestion"];
type FeeSource = FeeEstimate["source"];

// ── Helpers ────────────────────────────────────────────────────

function congestionBadgeVariant(congestion: CongestionLevel): "success" | "warning" | "danger" {
  if (congestion === "low") return "success";
  if (congestion === "medium") return "warning";
  return "danger";
}

function sourceBadgeVariant(source: FeeSource): "success" | "info" | "warning" {
  if (source === "horizon") return "success";
  if (source === "cache") return "info";
  return "warning";
}

function formatXlmFee(stroops: string): string {
  const num = Number(stroops);
  if (!Number.isFinite(num) || num <= 0) return "0";
  // 1 XLM = 10,000,000 stroops
  const xlm = num / 10_000_000;
  if (xlm >= 0.001) {
    // Trim trailing zeros: 0.0050000 → 0.005
    const trimmed = xlm.toFixed(7).replace(/\.?0+$/, "");
    return `${trimmed} XLM`;
  }
  return `${stroops} stroops`;
}

// ── Component ──────────────────────────────────────────────────

/**
 * Live network transaction fee estimator widget (bounty #1373).
 *
 * Displays the current recommended fee based on Horizon fee statistics,
 * refreshing automatically at a configurable interval. Shows congestion
 * level, data source, and staleness — giving the user full visibility
 * into why a fee is higher than the protocol base fee during congestion.
 *
 * Uses `estimateTransactionFee` from `@/lib/fee-estimator` which delegates
 * to `getRecommendedFee` (Horizon `/fee_stats` with caching + fallback).
 */
export function FeeEstimatorWidget({
  operations = 1,
  refreshIntervalMs = 30_000,
  showRefresh = true,
  showBasis = true,
  showStaleWarning = true,
  className,
  onEstimateChange,
  testIdPrefix = "fee-estimator",
}: FeeEstimatorWidgetProps) {
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Use a ref for the callback so the interval doesn't re-create when it changes.
  const onEstimateChangeRef = useRef(onEstimateChange);
  useEffect(() => {
    onEstimateChangeRef.current = onEstimateChange;
  }, [onEstimateChange]);

  const fetchFee = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const result = await estimateTransactionFee(operations);
        setEstimate(result);
        setLastUpdated(new Date());
        onEstimateChangeRef.current?.(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch fee estimate"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [operations]
  );

  // Initial fetch + auto-refresh interval
  useEffect(() => {
    fetchFee(false);

    if (refreshIntervalMs > 0) {
      const intervalId = setInterval(() => {
        fetchFee(true);
      }, refreshIntervalMs);

      return () => clearInterval(intervalId);
    }
  }, [fetchFee, refreshIntervalMs]);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    fetchFee(true);
  }, [fetchFee]);

  // ── Loading state ──────────────────────────────────────────

  if (loading && !estimate) {
    return (
      <div
        data-testid={`${testIdPrefix}-loading`}
        className={cn(
          "flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60",
          className
        )}
      >
        <Spinner size="sm" className="text-ophir-500" />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Fetching live network fee…
        </span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────

  if (error && !estimate) {
    return (
      <div
        data-testid={`${testIdPrefix}-error`}
        className={cn(
          "p-4 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20",
          className
        )}
        role="alert"
      >
        <p className="text-sm text-red-700 dark:text-red-400">
          Unable to load fee estimate. {error}
        </p>
        {showRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
            data-testid={`${testIdPrefix}-retry`}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!estimate) return null;

  // ── Main render ────────────────────────────────────────────

  return (
    <div
      data-testid={testIdPrefix}
      className={cn(
        "p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 space-y-3",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Network Fee
          </span>
          {estimate.stale && showStaleWarning && (
            <span
              data-testid={`${testIdPrefix}-stale-badge`}
              className="text-xs text-amber-600 dark:text-amber-400"
              title="Fee data may be stale"
            >
              ⚠ stale
            </span>
          )}
        </div>
        {showRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh fee estimate"
            data-testid={`${testIdPrefix}-refresh`}
          >
            {refreshing ? (
              <Spinner size="xs" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Fee values */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            Recommended fee{operations > 1 ? ` (${operations} ops)` : ""}
          </p>
          <p
            className="text-2xl font-bold font-mono text-gray-900 dark:text-white"
            data-testid={`${testIdPrefix}-recommended`}
          >
            {formatXlmFee(estimate.recommendedFee)}
          </p>
          {operations > 1 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Total: {formatXlmFee(estimate.totalFee)}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span data-testid={`${testIdPrefix}-congestion`}>
            <Badge variant={congestionBadgeVariant(estimate.networkCongestion)}>
              {estimate.networkCongestion === "high" && "🔥 "}
              {estimate.networkCongestion === "medium" && "⚡ "}
              {estimate.networkCongestion} congestion
            </Badge>
          </span>
          <span data-testid={`${testIdPrefix}-source`}>
            <Badge variant={sourceBadgeVariant(estimate.source)}>
              {estimate.source}
            </Badge>
          </span>
        </div>
      </div>

      {/* Detail row */}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span>
          Base fee: <span className="font-mono">{estimate.baseFee}</span> stroops
        </span>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <span>
          <span className="font-mono">{estimate.percentile}</span> percentile
        </span>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <span>{estimate.aggressiveness} bid</span>
      </div>

      {/* Basis / explanation */}
      {showBasis && estimate.basis && (
        <p
          data-testid={`${testIdPrefix}-basis`}
          className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed"
        >
          Based on {estimate.basis}
          {estimate.stale ? " (may be stale)" : ""}
        </p>
      )}

      {/* Last updated */}
      {lastUpdated && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
          Updated {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

export default FeeEstimatorWidget;
