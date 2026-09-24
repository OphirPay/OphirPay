// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import {
  successResponse,
  unauthorizedError,
  errorResponse,
  handleApiError,
  badRequestError,
} from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";
import { sendPaymentRequestReminder } from "@/lib/payment-requests";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = withMetrics(
  "POST /api/requests/[id]/remind",
  withRequestLogging(async function POST(request: Request, context: RouteParams) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key."
        );
      }

      const { id } = await context.params;
      const result = await sendPaymentRequestReminder(id, auth.userId);

      if (!result.success) {
        if (result.cooldownRemainingSeconds !== undefined) {
          return errorResponse(
            ERROR_CODES.RATE_LIMITED,
            result.error || "Rate limit reached. Please wait before sending another reminder.",
            429,
            { cooldownRemainingSeconds: result.cooldownRemainingSeconds }
          );
        }
        return badRequestError(result.error || "Unable to send reminder.");
      }

      return successResponse({
        id,
        reminderCount: result.reminderCount,
        lastReminderAt: result.lastReminderAt?.toISOString(),
      });
    } catch (err) {
      return handleApiError(err, "POST /api/requests/[id]/remind");
    }
  })
);
