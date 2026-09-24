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

/**
 * GET /api/analytics — Aggregated payment and refund metrics scoped to the
 * authenticated user, respecting date ranges and the most-recent window constraint.
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

      let startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      if (rangeParam && rangeParam !== "all" as DateRangePreset) {
        try {
          const dateRange = getDateRange(rangeParam);
          startDate = dateRange.from;
        } catch {
          // fallback to 30d
        }
      }

      const scope = { userId: auth.userId };

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
        // Fetch up to the most-recent 100 refunds (matching on-chain MEDIUM-2 bound)
        prisma.refund.findMany({
          where: {
            userId: auth.userId,
            ...(rangeParam !== "all" as DateRangePreset ? { requestedAt: { gte: startDate } } : {}),
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

      // Group refund reason codes 0..5
      const rawReasonCounts = [0, 1, 2, 3, 4, 5].map((code) => ({
        code,
        count: recentRefunds.filter((r) => r.reasonCode === code).length,
      }));

      const refundReasons = toRefundReasonChartData(rawReasonCounts);
      const refundTrends = toRefundTrendChartData(recentRefunds);

      return successResponse({
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
      });
    } catch (err) {
      return handleApiError(err, "GET /api/analytics");
    }
  })
);
