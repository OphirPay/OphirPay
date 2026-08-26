// SPDX-License-Identifier: MIT

/**
 * Chart data formatting utilities for analytics displays.
 * Transforms payment records into chart-ready datasets.
 */

interface DataPoint {
  label: string;
  value: number;
  color?: string;
}

interface TimeSeriesPoint {
  date: string;
  volume: number;
  count: number;
}

const CHART_COLORS = ["#7B68EE", "#14b7e6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

/**
 * Transform volume-by-day data into a line chart dataset.
 */
export function toVolumeChartData(data: TimeSeriesPoint[]) {
  return {
    labels: data.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: "Volume (XLM)",
        data: data.map((d) => d.volume),
        borderColor: CHART_COLORS[0],
        backgroundColor: `${CHART_COLORS[0]}20`,
        fill: true,
      },
    ],
  };
}

/**
 * Transform status aggregation into a pie/doughnut chart dataset.
 */
export function toStatusChartData(
  data: { status: string; count: number }[]
): DataPoint[] {
  return data.map((d, i) => ({
    label: d.status.replace(/_/g, " "),
    value: d.count,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
}

/**
 * Group payments by asset for multi-asset breakdown.
 */
export function groupByAsset(
  payments: { assetCode: string; amount: number }[]
): { assetCode: string; total: number; count: number }[] {
  const groups: Record<string, { total: number; count: number }> = {};
  for (const p of payments) {
    const code = p.assetCode || "XLM";
    if (!groups[code]) groups[code] = { total: 0, count: 0 };
    groups[code].total += p.amount;
    groups[code].count++;
  }
  return Object.entries(groups).map(([assetCode, v]) => ({
    assetCode,
    total: v.total,
    count: v.count,
  }));
}
