// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { authorizeCronRequest } from "@/lib/scheduler";
import {
  errorResponse,
  handleApiError,
  successResponse,
  unauthorizedError,
} from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { processWebhookRetryQueue } from "@/lib/webhook-delivery-service";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handleWebhookRetryCron(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
    if (!auth.ok) {
      if (auth.reason === "not-configured") {
        logger.error("Webhook retry sweep refused — CRON_SECRET is not configured");
        return errorResponse(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          "Webhook retry sweep is not configured — CRON_SECRET is unset.",
          503,
        );
      }
      return unauthorizedError("Invalid or missing cron secret.");
    }

    const summary = await processWebhookRetryQueue();
    return successResponse(summary);
  } catch (error) {
    return handleApiError(error, "CRON /api/cron/webhooks");
  }
}

export const GET = withMetrics(
  "GET /api/cron/webhooks",
  withRequestLogging(async function GET(request: Request) {
    return handleWebhookRetryCron(request);
  }),
);

export const POST = withMetrics(
  "POST /api/cron/webhooks",
  withRequestLogging(async function POST(request: Request) {
    return handleWebhookRetryCron(request);
  }),
);
