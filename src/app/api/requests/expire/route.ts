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
import { expireDuePaymentRequests } from "@/lib/payment-request-lifecycle";
import { withRequestLogging } from "@/lib/request-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withMetrics(
  "GET /api/requests/expire",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
      if (!auth.ok) {
        if (auth.reason === "not-configured") {
          logger.error("Request expiry sweep refused — CRON_SECRET is not configured");
          return errorResponse(
            ERROR_CODES.SERVICE_UNAVAILABLE,
            "Request expiry sweep is not configured — CRON_SECRET is unset.",
            503,
          );
        }
        return unauthorizedError("Invalid or missing cron secret.");
      }

      const expired = await expireDuePaymentRequests();
      return successResponse({ expired });
    } catch (error) {
      return handleApiError(error, "GET /api/requests/expire");
    }
  }),
);
