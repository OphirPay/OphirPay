// SPDX-License-Identifier: MIT

/**
 * Chart data formatting utilities for analytics displays.
 * Transforms payment records and refund analytics into chart-ready datasets.
 */

export interface DataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface TimeSeriesPoint {
  date: string;
  volume: number;
  count: number;
}

export const CHART_COLORS = [
  "#7B68EE", // Purple
  "#14b7e6", // Cyan
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Rose
  "#8b5cf6", // Indigo
];

/**
 * Maximum number of refund entries scanned in the on-chain aggregation window.
 * Enforces the MEDIUM-2 smart contract security bounded window limitation.
 */
export const MAX_REFUND_ANALYTICS_WINDOW = 100;

/**
 * Explanatory notice detailing the bounded window constraint.
 */
export const REFUND_WINDOW_LIMITATION_NOTICE =
  "Metrics reflect the most recent window of up to 100 refunds (bounded by the smart contract's audit constraint) rather than all-time lifetime totals.";

/**
 * Structured refund reason code catalog mirroring the Soroban OphirPayContract
 * RefundReasonCode enum (ProductDefect=0..Other=5).
 */
export interface RefundReasonDefinition {
  code: number;
  name: string;
  label: string;
  description: string;
  color: string;
}

export const REFUND_REASON_CATALOG: Record<number, RefundReasonDefinition> = {
  0: {
    code: 0,
    name: "ProductDefect",
    label: "Product Defect",
    description: "Goods or services were defective, damaged, or not as described.",
    color: "#ef4444", // Red
  },
  1: {
    code: 1,
    name: "NonDelivery",
    label: "Non-Delivery",
    description: "Ordered goods or services were never delivered.",
    color: "#f59e0b", // Amber
  },
  2: {
    code: 2,
    name: "DuplicateCharge",
    label: "Duplicate Charge",
    description: "Customer was charged multiple times for the same transaction.",
    color: "#8b5cf6", // Purple
  },
  3: {
    code: 3,
    name: "Unauthorized",
    label: "Unauthorized Charge",
    description: "Payment was unauthorized or flagged as fraudulent.",
    color: "#ec4899", // Pink
  },
  4: {
    code: 4,
    name: "CustomerRequest",
    label: "Customer Request",
    description: "Buyer requested a standard cancellation, return, or exchange.",
    color: "#10b981", // Green
  },
  5: {
    code: 5,
    name: "Other",
    label: "Other Reason",
    description: "Operational dispute or unclassified refund reason.",
    color: "#6b7280", // Gray
  },
};

/**
 * Retrieve the human-readable label for a refund reason code.
 */
export function getRefundReasonLabel(code: number): string {
  return REFUND_REASON_CATALOG[code]?.label ?? `Reason Code #${code}`;
}

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

export interface RefundReasonChartItem {
  code: number;
  label: string;
  description: string;
  count: number;
  percentage: number;
  color: string;
}

/**
 * Transform raw reason code counts into labeled chart items with percentages.
 */
export function toRefundReasonChartData(
  analytics: { code: number; count: number }[]
): RefundReasonChartItem[] {
  const total = analytics.reduce((sum, item) => sum + item.count, 0);

  return [0, 1, 2, 3, 4, 5].map((code) => {
    const found = analytics.find((a) => a.code === code);
    const count = found?.count ?? 0;
    const def = REFUND_REASON_CATALOG[code];
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

    return {
      code,
      label: def.label,
      description: def.description,
      count,
      percentage,
      color: def.color,
    };
  });
}

export interface RefundTrendPoint {
  date: string;
  total: number;
  byReason: Record<number, number>;
}

/**
 * Aggregate refunds by day and reason code for trend visualization over a date range.
 */
export function toRefundTrendChartData(
  refunds: { reasonCode: number; requestedAt: string | Date }[]
): RefundTrendPoint[] {
  const dailyMap = new Map<string, { total: number; byReason: Record<number, number> }>();

  for (const r of refunds) {
    const dateObj = typeof r.requestedAt === "string" ? new Date(r.requestedAt) : r.requestedAt;
    if (isNaN(dateObj.getTime())) continue;

    const dateKey = dateObj.toISOString().split("T")[0];
    let entry = dailyMap.get(dateKey);
    if (!entry) {
      entry = {
        total: 0,
        byReason: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
      dailyMap.set(dateKey, entry);
    }

    entry.total += 1;
    if (entry.byReason[r.reasonCode] !== undefined) {
      entry.byReason[r.reasonCode] += 1;
    } else {
      entry.byReason[r.reasonCode] = 1;
    }
  }

  return Array.from(dailyMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, data]) => ({
      date,
      total: data.total,
      byReason: data.byReason,
    }));
}
