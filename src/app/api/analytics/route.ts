// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { z } from "zod";
import {
  successResponse,
  unauthorizedError,
  badRequestError,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";

const ISO_OR_DATE_STRING = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format. Expected valid ISO-8601 or YYYY-MM-DD date string.",
});

const analyticsQuerySchema = z.object({
  from: ISO_OR_DATE_STRING.optional(),
  to: ISO_OR_DATE_STRING.optional(),
  startDate: ISO_OR_DATE_STRING.optional(),
  endDate: ISO_OR_DATE_STRING.optional(),
  days: z.coerce.number().int().min(1, "days must be at least 1").max(365, "days cannot exceed 365").optional(),
});

/**
 * GET /api/analytics — Aggregated payment metrics scoped to the
 * authenticated user. Supports safe parameterized date range filtering (#1396).
 */
export const GET = withMetrics("GET /api/analytics", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = analyticsQuerySchema.safeParse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      days: searchParams.get("days") ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { days } = parsed.data;
    const rawFrom = parsed.data.from || parsed.data.startDate;
    const rawTo = parsed.data.to || parsed.data.endDate;

    let fromDate: Date;
    const toDate: Date = rawTo ? new Date(rawTo) : new Date();

    if (days) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
    } else if (rawFrom) {
      fromDate = new Date(rawFrom);
    } else {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
    }

    if (fromDate > toDate) {
      return badRequestError("'from' date cannot be after 'to' date");
    }

    const scope = { userId: auth.userId };
    const dateRangeCachePart = `${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}`;

    const { value: payload, status } = await cachedRead(
      readCacheKey("analytics", `${auth.userId}:${dateRangeCachePart}`),
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

        const dailyPayments = await prisma.payment.groupBy({
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
