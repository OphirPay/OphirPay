"use client";
// SPDX-License-Identifier: MIT

// Lazy-loaded analytics dashboard. Extracted from src/app/analytics/page.tsx so
// the heavy on-chain chart/metrics code (including the @/lib/contracts module)
// is only fetched when the Analytics route is actually opened, keeping the
// initial bundle lean. Rendered through next/dynamic with a skeleton fallback.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PAGE_TITLES } from "@/lib/page-titles";
import { useWallet } from "@/hooks/useMultiWallet";
import {
  fetchOnChainPayments,
  type OnChainPayment,
} from "@/lib/contracts";
import { formatAmount } from "@/lib/utils";
import { XLM_STROOPS } from "@/lib/stellar";
import Link from "next/link";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Card } from "@/components/ui/Card";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { DateRangePreset } from "@/lib/date-range";
import {
  type RefundReasonChartItem,
  type RefundTrendPoint,
  REFUND_WINDOW_LIMITATION_NOTICE,
} from "@/lib/chart-data";

export function AnalyticsDashboard() {
  usePageTitle(PAGE_TITLES.ANALYTICS);
  const { wallet } = useWallet();
  const [payments, setPayments] = useState<OnChainPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundRange, setRefundRange] = useState<DateRangePreset | "all">("30d");

  const {
    data: refundAnalyticsResponse,
    isLoading: refundLoading,
    isError: refundError,
    refetch: refetchRefundAnalytics,
  } = useApiQuery<{
    success: boolean;
    data: {
      buckets: RefundReasonChartItem[];
      trends: RefundTrendPoint[];
      total: number;
      maxWindow: number;
      windowNotice: string;
      range: string;
    };
  }>(
    ["refunds", "analytics", refundRange],
    `/api/refunds?analytics=true&detailed=true&range=${refundRange}`
  );

  const refundBuckets = useMemo(
    () => refundAnalyticsResponse?.data?.buckets ?? [],
    [refundAnalyticsResponse]
  );
  const totalRefunds = refundAnalyticsResponse?.data?.total ?? 0;
  const windowNotice =
    refundAnalyticsResponse?.data?.windowNotice ?? REFUND_WINDOW_LIMITATION_NOTICE;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOnChainPayments(100);
      setPayments(result.payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = useMemo(() => {
    const total = payments.length;
    const volume = payments.reduce((s, p) => s + p.amountStroops / XLM_STROOPS, 0);
    const uniquePayers = new Set(payments.map((p) => p.payer)).size;
    const uniquePayees = new Set(payments.map((p) => p.payee)).size;
    const avgAmount = total > 0 ? volume / total : 0;
    const maxAmount = payments.reduce((m, p) => Math.max(m, p.amountStroops / XLM_STROOPS), 0);

    // Daily volume data for chart
    const dailyMap = new Map<string, number>();
    payments.forEach((p) => {
      if (p.timestamp) {
        const day = new Date(p.timestamp * 1000).toISOString().split("T")[0];
        dailyMap.set(day, (dailyMap.get(day) || 0) + p.amountStroops / XLM_STROOPS);
      }
    });
    const chartData = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vol]) => ({ date, volume: vol }));

    return { total, volume, uniquePayers, uniquePayees, avgAmount, maxAmount, chartData };
  }, [payments]);

  const maxVolume = Math.max(1, ...metrics.chartData.map((d) => d.volume));

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            On-chain payment metrics from the OphirPay Soroban contract
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-sm text-red-600 dark:text-red-400 underline">
            Try again
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton variant="stats" />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Payments" value={metrics.total.toString()} icon="💳" />
            <MetricCard label="Total Volume" value={formatAmount(metrics.volume, "XLM")} icon="📊" />
            <MetricCard label="Unique Payers" value={metrics.uniquePayers.toString()} icon="👤" />
            <MetricCard label="Avg Payment" value={formatAmount(metrics.avgAmount, "XLM")} icon="📈" />
          </div>

          {/* Chart + Detail Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bar Chart */}
            <Card title="Daily Volume" className="lg:col-span-2" padding="md">
              {metrics.chartData.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 dark:text-gray-400">No timestamped data yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {metrics.chartData.slice(-14).map((d) => (
                    <div key={d.date} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 shrink-0">
                        {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-ophir-500 to-stellar rounded-full transition-all duration-500"
                          style={{ width: `${(d.volume / maxVolume) * 100}%`, minWidth: "4px" }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-700 dark:text-gray-300 w-20 text-right">
                        {formatAmount(d.volume, "XLM")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Distribution */}
            <Card title="Summary" padding="md">
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Unique Payees</span>
                  <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                    {metrics.uniquePayees}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Largest Payment</span>
                  <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                    {formatAmount(metrics.maxAmount, "XLM")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Network</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-xs font-medium text-blue-700 dark:text-blue-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    TESTNET
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Wallet</span>
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
                    {wallet.connected ? "Connected" : "—"}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* Refund Reason Analytics */}
          <Card title="Refund Reason Breakdown" padding="md" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Distribution of refunds by structured reason code
                </p>
              </div>

              {/* Date-Range Selector */}
              <div
                className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg text-xs font-medium self-start sm:self-auto"
                role="group"
                aria-label="Refund date range selector"
              >
                {(
                  [
                    { value: "7d", label: "7D" },
                    { value: "30d", label: "30D" },
                    { value: "90d", label: "90D" },
                    { value: "all", label: "All Recent" },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setRefundRange(preset.value)}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      refundRange === preset.value
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-semibold"
                        : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bounded Window Limitation Notice */}
            <div
              role="note"
              data-testid="refund-window-notice"
              className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5"
            >
              <span className="text-blue-600 dark:text-blue-400 text-sm shrink-0">ℹ️</span>
              <p className="leading-relaxed">{windowNotice}</p>
            </div>

            {refundLoading ? (
              <LoadingSkeleton lines={3} variant="card" />
            ) : refundError ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  Unable to load refund reason metrics.
                </p>
                <button
                  type="button"
                  onClick={() => refetchRefundAnalytics()}
                  className="text-xs text-blue-600 hover:underline cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : totalRefunds === 0 ? (
              <div className="py-8 text-center text-gray-400">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  No refunds recorded in this period
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Refund reasons will appear here once refunds are initiated on-chain.
                </p>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {refundBuckets.map((bucket) => (
                  <div key={bucket.code} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: bucket.color }}
                        />
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {bucket.label}
                        </span>
                        <span className="text-[11px] text-gray-400">(#{bucket.code})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {bucket.count}
                        </span>
                        <span className="text-gray-400 font-mono text-[11px] w-10 text-right">
                          ({bucket.percentage}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${bucket.percentage}%`,
                          backgroundColor: bucket.color,
                        }}
                      />
                    </div>
                  </div>
                ))}

                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                  <Link
                    href="/refunds"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    View detailed refund management →
                  </Link>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white truncate">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </Card>
  );
}