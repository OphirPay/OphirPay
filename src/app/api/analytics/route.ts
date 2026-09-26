// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { getDateRange, type DateRangePreset } from "@/lib/date-range";
import {
  toRefundReasonChartData,
  toRefundTrendChartData,
  MAX_REFUND_ANALYTICS_WINDOW,
  REFUND_WINDOW_LIMITATION_NOTICE,
} from "@/lib/chart-data";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/analytics — Aggregated payment and refund metrics scoped to the
 * authenticated user, respecting date ranges and the most-recent window constraint.
 *
 * Aggregate queries per request, cached per user and range for a few seconds (#741).
 */
export const GET = withMetrics(
  "GET /api/analytics",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key."
        );
      }

      const { searchParams } = new URL(request.url);
      const rangeParam = (searchParams.get("range") as DateRangePreset) || "30d";

      const scope = { userId: auth.userId };

      const { value: payload, status } = await cachedRead(
        readCacheKey("analytics", `${auth.userId}:${rangeParam}`),
        async () => {
          let startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);

          if (rangeParam && (rangeParam as string) !== "all") {
            try {
              const dateRange = getDateRange(rangeParam);
              startDate = dateRange.from;
            } catch {
              // fallback to 30d
            }
          }

          const [
            totalPayments,
            completedPayments,
            failedPayments,
            volumeResult,
            dailyPayments,
            recentRefunds,
          ] = await Promise.all([
            prisma.payment.count({ where: scope }),
            prisma.payment.count({ where: { ...scope, status: "COMPLETED" } }),
            prisma.payment.count({ where: { ...scope, status: "FAILED" } }),
            prisma.payment.aggregate({
              _sum: { amount: true },
              _avg: { amount: true },
              where: { ...scope, status: "COMPLETED" },
            }),
            prisma.payment.groupBy({
              by: ["createdAt"],
              _count: { id: true },
              _sum: { amount: true },
              where: {
                ...scope,
                createdAt: { gte: startDate },
                status: "COMPLETED",
              },
              orderBy: { createdAt: "asc" },
            }),
            prisma.refund.findMany({
              where: {
                userId: auth.userId,
                ...((rangeParam as string) !== "all" ? { requestedAt: { gte: startDate } } : {}),
              },
              orderBy: { requestedAt: "desc" },
              take: MAX_REFUND_ANALYTICS_WINDOW,
              select: {
                id: true,
                reasonCode: true,
                requestedAt: true,
              },
            }),
          ]);

          const volumeByDay = dailyPayments.map((d) => ({
            date: d.createdAt.toISOString().split("T")[0],
            volume: d._sum.amount ?? 0,
            count: d._count.id,
          }));

          const rawReasonCounts = [0, 1, 2, 3, 4, 5].map((code) => ({
            code,
            count: recentRefunds.filter((r) => r.reasonCode === code).length,
          }));

          const refundReasons = toRefundReasonChartData(rawReasonCounts);
          const refundTrends = toRefundTrendChartData(recentRefunds);

          return {
            totalPayments,
            completedPayments,
            failedPayments,
            totalVolume: volumeResult._sum.amount ?? 0,
            averageAmount: volumeResult._avg.amount ?? 0,
            successRate:
              totalPayments > 0
                ? Math.round((completedPayments / totalPayments) * 100)
                : 0,
            volumeByDay,
            refundAnalytics: {
              reasons: refundReasons,
              trends: refundTrends,
              totalRefundsInWindow: recentRefunds.length,
              maxWindow: MAX_REFUND_ANALYTICS_WINDOW,
              windowNotice: REFUND_WINDOW_LIMITATION_NOTICE,
              range: rangeParam,
            },
          };
        },
        READ_TTL_MS.analytics
      );

      return successResponse(payload, undefined, 200, readCacheHeaders(status));
    } catch (err) {
      return handleApiError(err, "GET /api/analytics");
    }
  })
);
