// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { TimeoutError } from "@/lib/timeout";

/** Default query timeout for analytics aggregations: 5 seconds (issue #2024). */
export const ANALYTICS_QUERY_TIMEOUT_MS = 5000;

export interface AnalyticsQueryScope {
  userId: string;
}

export interface DailyVolumeEntry {
  date: string;
  volume: number;
  count: number;
}

export interface AnalyticsMetricsResult {
  totalPayments: number;
  completedPayments: number;
  failedPayments: number;
  totalVolume: number;
  averageAmount: number;
  successRate: number;
  volumeByDay: DailyVolumeEntry[];
}

export interface AnalyticsQueryOptions {
  timeoutMs?: number;
}

/**
 * Execute aggregated payment metrics queries with an enforced query timeout (issue #2024).
 * Prevents database connection pool exhaustion under heavy reporting queries.
 */
export async function getAnalyticsMetrics(
  scope: AnalyticsQueryScope,
  fromDate: Date,
  toDate: Date,
  options: AnalyticsQueryOptions = {}
): Promise<AnalyticsMetricsResult> {
  const timeoutMs = options.timeoutMs ?? ANALYTICS_QUERY_TIMEOUT_MS;

  const executeQueries = async (client: typeof prisma): Promise<AnalyticsMetricsResult> => {
    const [totalPayments, completedPayments, failedPayments, volumeResult] =
      await Promise.all([
        client.payment.count({ where: scope }),
        client.payment.count({ where: { ...scope, status: "COMPLETED" } }),
        client.payment.count({ where: { ...scope, status: "FAILED" } }),
        client.payment.aggregate({
          _sum: { amount: true },
          _avg: { amount: true },
          where: { ...scope, status: "COMPLETED" },
        }),
      ]);

    const dailyPayments = await client.payment.groupBy({
      by: ["createdAt"],
      _count: { id: true },
      _sum: { amount: true },
      where: {
        ...scope,
        createdAt: { gte: fromDate, lte: toDate },
        status: "COMPLETED",
      },
      orderBy: { createdAt: "asc" },
    });

    const volumeByDay: DailyVolumeEntry[] = dailyPayments.map((d) => ({
      date: (d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt))
        .toISOString()
        .split("T")[0],
      volume: d._sum.amount !== null && d._sum.amount !== undefined ? Number(d._sum.amount) : 0,
      count: d._count.id,
    }));

    return {
      totalPayments,
      completedPayments,
      failedPayments,
      totalVolume:
        volumeResult._sum.amount !== null && volumeResult._sum.amount !== undefined
          ? Number(volumeResult._sum.amount)
          : 0,
      averageAmount:
        volumeResult._avg.amount !== null && volumeResult._avg.amount !== undefined
          ? Number(volumeResult._avg.amount)
          : 0,
      successRate:
        totalPayments > 0
          ? Math.round((completedPayments / totalPayments) * 100)
          : 0,
      volumeByDay,
    };
  };

  const runWithDatabaseTimeout = async (): Promise<AnalyticsMetricsResult> => {
    // If $transaction is available on the client (or mock), enforce query timeout at the Prisma level
    if (typeof (prisma as unknown as { $transaction?: unknown }).$transaction === "function") {
      try {
        return await (prisma as unknown as {
          $transaction: <T>(
            fn: (tx: typeof prisma) => Promise<T>,
            opts?: { timeout?: number; maxWait?: number }
          ) => Promise<T>;
        }).$transaction(
          async (tx) => executeQueries(tx),
          { timeout: timeoutMs, maxWait: Math.min(2000, timeoutMs) }
        );
      } catch (err) {
        if (
          (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2028") ||
          (err instanceof Error && /timeout|timed out|canceling statement due to statement timeout/i.test(err.message))
        ) {
          throw new TimeoutError(timeoutMs, "Analytics aggregation query");
        }
        throw err;
      }
    }
    return executeQueries(prisma);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs, "Analytics aggregation query"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([runWithDatabaseTimeout(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
