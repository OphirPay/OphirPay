// SPDX-License-Identifier: MIT

import {
  executeDueScheduledPayments,
  getScheduledSourcePublicKey,
  SCHEDULED_SOURCE_SECRET_ENV,
} from "@/lib/scheduled-payments";
import {
  successResponse,
  unauthorizedError,
  errorResponse,
  handleApiError,
} from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * Cron endpoint — executes due scheduled payments.
 *
 * Invoked by the Vercel cron defined in vercel.json. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET env var is set,
 * so the handler accepts either that header or `x-cron-secret`.
 *
 * If `SCHEDULED_PAYMENTS_SOURCE_SECRET` is not configured the endpoint
 * refuses to run (503) without touching any records, so a misconfigured
 * deployment never fails every due payment.
 */

const CRON_SECRET_ENV = "CRON_SECRET";

function isAuthorizedCron(request: Request): boolean {
  const secret = process.env[CRON_SECRET_ENV];
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

async function runCron(request: Request) {
  try {
    if (!isAuthorizedCron(request)) {
      return unauthorizedError("Invalid cron secret");
    }

    let sourcePublicKey: string;
    try {
      sourcePublicKey = getScheduledSourcePublicKey();
    } catch {
      return errorResponse(
        ERROR_CODES.CONFIG_ERROR,
        `${SCHEDULED_SOURCE_SECRET_ENV} is not configured — scheduled payments cannot be executed`,
        503
      );
    }

    const summary = await executeDueScheduledPayments();
    logger.info("Scheduled payments cron run", {
      picked: summary.picked,
      executed: summary.executed,
      failed: summary.failed,
    });

    return successResponse({ ...summary, sourcePublicKey });
  } catch (err) {
    return handleApiError(err, "POST /api/scheduled/run");
  }
}

export const GET = withRequestLogging(runCron);
export const POST = withRequestLogging(runCron);
