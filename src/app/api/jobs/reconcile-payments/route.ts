// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { unauthorizedError, successResponse, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { runPaymentStatusSync, SyncTrigger } from "@/lib/payment-sync";
import { authorizeCronRequest } from "@/lib/scheduler";

/**
 * POST /api/jobs/reconcile-payments
 *
 * Runs a reconciliation sweep over SUBMITTED payments against Horizon.
 * Acts as the safety net and fallback for payments whose real-time stream
 * events may have been missed (e.g. during deployments or network drops).
 *
 * Authorized via either:
 *   - Admin user session
 *   - Cron secret (x-cron-secret or Authorization: Bearer <CRON_SECRET>)
 */
export const POST = withMetrics(
  "POST /api/jobs/reconcile-payments",
  withRequestLogging(async function POST(request: Request) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      let trigger: SyncTrigger = "admin";

      // 1. Try cron secret authorization
      const cronAuth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
      if (cronAuth.ok) {
        trigger = "cron";
      } else {
        // 2. Fall back to user session authorization
        const auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError("Authentication required (valid session or cron secret).");
        }
      }

      const summary = await runPaymentStatusSync(trigger);
      return successResponse(summary);
    } catch (err) {
      return handleApiError(err, "POST /api/jobs/reconcile-payments");
    }
  })
);

/**
 * GET /api/jobs/reconcile-payments
 *
 * Supported for scheduled runners (e.g. Vercel Cron).
 */
export const GET = withMetrics(
  "GET /api/jobs/reconcile-payments",
  withRequestLogging(async function GET(request: Request) {
    try {
      const cronAuth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
      let trigger: SyncTrigger = "cron";

      if (!cronAuth.ok) {
        const auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError("Authentication required (valid session or cron secret).");
        }
        trigger = "admin";
      }

      const summary = await runPaymentStatusSync(trigger);
      return successResponse(summary);
    } catch (err) {
      return handleApiError(err, "GET /api/jobs/reconcile-payments");
    }
  })
);
