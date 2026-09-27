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
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

/**
 * GET /api/analytics — Aggregated payment metrics scoped to the
 * authenticated user. Previously returned platform-wide totals.
 *
 * Four aggregate queries per request, cached per user for a few seconds
 * (#741). The key is scoped by `userId`, so one user's cached counts can never
 * be served to another, and invalidation on payment creation is per-user
 * (`invalidateCache("analytics", userId)`).
 */
export const GET = withMetrics("GET /api/analytics", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const scope = { userId: auth.userId };

    const { value: payload, status } = await cachedRead(
      readCacheKey("analytics", auth.userId),
      async () => {
        const [totalPayments, completedPayments, failedPayments, volumeResult] =
          await Promise.all([
            prisma.payment.count({ where: scope }),
            prisma.payment.count({ where: { ...scope, status: "COMPLETED" } }),
            prisma.payment.count({ where: { ...scope, status: "FAILED" } }),
            prisma.payment.aggregate({
              _sum: { amount: true },
              _avg: { amount: true },
              where: { ...scope, status: "COMPLETED" },
            }),
          ]);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const dailyPayments = await prisma.payment.groupBy({
          by: ["createdAt"],
          _count: { id: true },
          _sum: { amount: true },
          where: {
            ...scope,
            createdAt: { gte: thirtyDaysAgo },
            status: "COMPLETED",
          },
          orderBy: { createdAt: "asc" },
        });

        const volumeByDay = dailyPayments.map((d) => ({
          date: d.createdAt.toISOString().split("T")[0],
          volume: d._sum.amount ?? 0,
          count: d._count.id,
        }));

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
        };
      },
      READ_TTL_MS.analytics
    );

    return successResponse(payload, undefined, 200, readCacheHeaders(status));
  } catch (err) {
    return handleApiError(err, "GET /api/analytics");
  }
}));
