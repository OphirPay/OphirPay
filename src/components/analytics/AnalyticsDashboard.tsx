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
import { formatAmount, shortenAddress } from "@/lib/utils";
import { XLM_STROOPS } from "@/lib/stellar";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { ErrorBoundary, WidgetErrorFallback } from "@/components/ErrorBoundary";
import { Card } from "@/components/ui/Card";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export function AnalyticsDashboard() {
  usePageTitle(PAGE_TITLES.ANALYTICS);
  const { wallet } = useWallet();
  const [payments, setPayments] = useState<OnChainPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOnChainPayments(100);
      setPayments(result.payments);
      setCurrentPage(1);
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

  const totalPages = Math.max(1, Math.ceil(payments.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedAuditRows = useMemo(
    () => payments.slice(startIndex, startIndex + pageSize),
    [payments, startIndex, pageSize]
  );

  const handlePageSizeChange = (nextSize: number) => {
    setPageSize(nextSize);
    setCurrentPage(1);
  };

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
          <ErrorBoundary
            segment="analytics-kpi-cards"
            onRetry={load}
            fallback={({ error: widgetErr, reset }) => (
              <WidgetErrorFallback
                title="KPI Metrics Unavailable"
                error={widgetErr}
                onRetry={reset}
              />
            )}
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Total Payments" value={metrics.total.toString()} icon="💳" />
              <MetricCard label="Total Volume" value={formatAmount(metrics.volume, "XLM")} icon="📊" />
              <MetricCard label="Unique Payers" value={metrics.uniquePayers.toString()} icon="👤" />
              <MetricCard label="Avg Payment" value={formatAmount(metrics.avgAmount, "XLM")} icon="📈" />
            </div>
          </ErrorBoundary>

          {/* Chart + Detail Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bar Chart */}
            <div className="lg:col-span-2">
              <ErrorBoundary
                segment="analytics-daily-volume"
                onRetry={load}
                fallback={({ error: widgetErr, reset }) => (
                  <WidgetErrorFallback
                    title="Daily Volume Chart Unavailable"
                    error={widgetErr}
                    onRetry={reset}
                  />
                )}
              >
                <Card title="Daily Volume" padding="md">
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
              </ErrorBoundary>
            </div>

            {/* Distribution */}
            <div>
              <ErrorBoundary
                segment="analytics-summary"
                onRetry={load}
                fallback={({ error: widgetErr, reset }) => (
                  <WidgetErrorFallback
                    title="Summary Widget Unavailable"
                    error={widgetErr}
                    onRetry={reset}
                  />
                )}
              >
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
              </ErrorBoundary>
            </div>
          </div>

          {/* Audit Log Table with Page Size Selector (#1909) */}
          <Card title="Payment Audit Log" padding="md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing {payments.length === 0 ? 0 : startIndex + 1}–
                {Math.min(startIndex + pageSize, payments.length)} of {payments.length} entries
              </p>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="audit-log-page-size"
                  className="text-xs font-medium text-gray-600 dark:text-gray-300"
                >
                  Rows per page:
                </label>
                <select
                  id="audit-log-page-size"
                  data-testid="audit-log-page-size-select"
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {paginatedAuditRows.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No audit log entries available
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                      <th className="py-2 pr-4 font-medium">Payer</th>
                      <th className="py-2 pr-4 font-medium">Payee</th>
                      <th className="py-2 pr-4 font-medium text-right">Amount</th>
                      <th className="py-2 font-medium text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {paginatedAuditRows.map((entry, idx) => (
                      <tr key={`${entry.payer}-${entry.payee}-${entry.timestamp}-${startIndex + idx}`}>
                        <td className="py-2.5 pr-4 font-mono text-gray-800 dark:text-gray-200">
                          {shortenAddress(entry.payer, 6)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-gray-800 dark:text-gray-200">
                          {shortenAddress(entry.payee, 6)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-right text-gray-900 dark:text-white">
                          {formatAmount(entry.amountStroops / XLM_STROOPS, "XLM")}
                        </td>
                        <td className="py-2.5 text-right text-gray-500 dark:text-gray-400">
                          {entry.timestamp
                            ? new Date(entry.timestamp * 1000).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 disabled:opacity-40"
                  >
                    Next
                  </button>
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
