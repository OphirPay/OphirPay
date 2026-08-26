// SPDX-License-Identifier: MIT

/**
 * Analytics computation helpers for payment metrics.
 */

interface PaymentRecord {
  amount: number;
  status: string;
  createdAt: string;
}

interface AnalyticsSummary {
  totalVolume: number;
  totalCount: number;
  successfulCount: number;
  failedCount: number;
  successRate: number;
  averageAmount: number;
  medianAmount: number;
  largestAmount: number;
  smallestAmount: number;
}

/** Compute summary analytics from a list of payment records. */
export function computeAnalytics(payments: PaymentRecord[]): AnalyticsSummary {
  const total = payments.length;
  const successful = payments.filter((p) => p.status === "COMPLETED");
  const failed = payments.filter((p) => p.status === "FAILED");
  const amounts = payments.map((p) => p.amount).sort((a, b) => a - b);

  return {
    totalVolume: amounts.reduce((s, a) => s + a, 0),
    totalCount: total,
    successfulCount: successful.length,
    failedCount: failed.length,
    successRate: total > 0 ? (successful.length / total) * 100 : 0,
    averageAmount: total > 0 ? amounts.reduce((s, a) => s + a, 0) / total : 0,
    medianAmount: total > 0 ? amounts[Math.floor(total / 2)] : 0,
    largestAmount: amounts[amounts.length - 1] || 0,
    smallestAmount: amounts[0] || 0,
  };
}

/** Group payments by day and compute daily totals. */
export function groupByDay(
  payments: PaymentRecord[]
): { date: string; volume: number; count: number }[] {
  const byDay: Record<string, { volume: number; count: number }> = {};
  for (const p of payments) {
    const day = p.createdAt.split("T")[0];
    if (!byDay[day]) byDay[day] = { volume: 0, count: 0 };
    byDay[day].volume += p.amount;
    byDay[day].count += 1;
  }
  return Object.entries(byDay)
    .map(([date, v]) => ({ date, volume: v.volume, count: v.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Compute percentage change between two values. */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}
