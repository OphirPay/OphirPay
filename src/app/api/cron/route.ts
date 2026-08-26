// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import {
  processDueRecurrences,
  CRON_BATCH_LIMIT,
} from "@/lib/scheduler";

/**
 * GET /api/cron — Vercel Cron entrypoint for scheduled payment execution.
 *
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
 * invocations. The endpoint fails closed: no secret configured or a mismatched
 * bearer means the run is rejected.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      logger.error("CRON_SECRET is not configured - rejecting cron run");
      return unauthorizedError("Cron endpoint is not configured");
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return unauthorizedError("Invalid cron credentials");
    }

    const now = new Date();
    const results = await processDueRecurrences(prisma, now, CRON_BATCH_LIMIT);

    const executed = results.filter((r) => r.executed).length;
    const skipped = results.filter((r) => !r.executed).length;
    if (executed > 0) logger.info(`Cron executed ${executed} scheduled payments`, { executed, skipped });

    return successResponse(
      {
        ranAt: now.toISOString(),
        executed,
        skipped,
        results,
      },
      { timestamp: now.toISOString() }
    );
  } catch (err) {
    return handleApiError(err, "GET /api/cron");
  }
}
