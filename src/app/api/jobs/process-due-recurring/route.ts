// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import prisma from "@/lib/prisma";
import { unauthorizedError, successResponse, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { claimDueRecurrences, createRunPayment } from "@/lib/recurring-scheduler";

/**
 * POST /api/jobs/process-due-recurring
 *
 * One sweep of the at-most-once recurring scheduler. Safe to call from any
 * number of workers (cron / k8s replicas): the CAS claim + unique run key
 * guarantee a due schedule generates at most one Payment row.
 *
 * Body: { limit?: number }
 * Response: { claimed, created, duplicates, skipped }
 */
export const POST = withMetrics(
  "POST /api/jobs/process-due-recurring",
  withRequestLogging(async function POST(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const body = (await request.json().catch(() => ({}))) as { limit?: number };
      const limit = Number.isInteger(body.limit) && body.limit! > 0 ? body.limit! : undefined;

      const now = new Date();
      const runs = await claimDueRecurrences(now, limit);

      let created = 0;
      let duplicates = 0;
      for (const run of runs) {
        const recurrence = await prisma.recurrence.findUnique({
          where: { id: run.recurrenceId },
          select: {
            userId: true,
            amount: true,
            assetCode: true,
            assetIssuer: true,
            destAddress: true,
            description: true,
          },
        });
        if (!recurrence) {
          duplicates += 1; // cancelled/removed mid-race — no run to create
          continue;
        }

        const outcome = await createRunPayment(run, {
          userId: recurrence.userId,
          amount: recurrence.amount.toString(),
          assetCode: recurrence.assetCode,
          assetIssuer: recurrence.assetIssuer,
          destAddress: recurrence.destAddress,
          description: recurrence.description,
        });

        if (outcome === "created") {
          created += 1;
        } else {
          duplicates += 1; // P2002 dedupe — another worker created this run
        }
      }

      return successResponse({
        claimed: runs.length,
        created,
        duplicates,
      });
    } catch (err) {
      return handleApiError(err, "POST /api/jobs/process-due-recurring");
    }
  }),
);
