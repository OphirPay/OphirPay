// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { reconcilePendingPayments } from "@/lib/reconciliation";
import { z } from "zod";

const reconcileQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  maxAgeMinutes: z.coerce.number().int().min(1).default(10),
});

/**
 * GET /api/payments/reconcile — Check pending transactions queue depth and health.
 */
export const GET = withMetrics(
  "GET /api/payments/reconcile",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError("Authentication required.");
      }

      const pendingCount = await prisma.payment.count({
        where: {
          status: { in: ["PENDING", "SUBMITTED"] },
          deletedAt: null,
        },
      });

      const recentFailedCount = await prisma.payment.count({
        where: {
          status: "FAILED",
          deletedAt: null,
          updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });

      return successResponse({
        pendingQueueCount: pendingCount,
        recentFailed24hCount: recentFailedCount,
        status: pendingCount > 100 ? "backlogged" : "healthy",
      });
    } catch (err) {
      return handleApiError(err, "GET /api/payments/reconcile");
    }
  })
);

/**
 * POST /api/payments/reconcile — Run on-demand or periodic reconciliation with Horizon.
 */
export const POST = withMetrics(
  "POST /api/payments/reconcile",
  withRequestLogging(async function POST(request: Request) {
    try {
      // Check Bearer CRON_SECRET or authenticated user/admin session
      const authHeader = request.headers.get("authorization");
      const cronSecret = process.env.CRON_SECRET;
      const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;

      let userId: string | undefined;
      if (!isCronAuthorized) {
        const auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError("Authentication required to run reconciliation.");
        }
        // Scope to user if not an admin
        userId = auth.userId;
      }

      const url = new URL(request.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());
      const body = await request.json().catch(() => ({}));
      const merged = { ...queryParams, ...body };

      const parsed = reconcileQuerySchema.safeParse(merged);
      const { limit, maxAgeMinutes } = parsed.success ? parsed.data : { limit: 50, maxAgeMinutes: 10 };

      const result = await reconcilePendingPayments({
        limit,
        maxAgeMinutes,
        userId,
      });

      return successResponse(result);
    } catch (err) {
      return handleApiError(err, "POST /api/payments/reconcile");
    }
  })
);
