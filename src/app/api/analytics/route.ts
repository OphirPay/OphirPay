// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/analytics — Aggregated payment metrics scoped to the
 * authenticated user. Previously returned platform-wide totals.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const scope = { userId: auth.userId };

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
    });
  } catch (err) {
    return handleApiError(err, "GET /api/analytics");
  }
});
