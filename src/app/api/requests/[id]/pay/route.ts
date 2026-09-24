// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import {
  successResponse,
  badRequestError,
  handleApiError,
} from "@/lib/api-response";
import { markPaymentRequestPaid } from "@/lib/payment-requests";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = withMetrics(
  "POST /api/requests/[id]/pay",
  withRequestLogging(async function POST(request: Request, context: RouteParams) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const body = await request.json().catch(() => ({}));
      const transactionHash = body.transactionHash || body.txHash;

      if (!transactionHash || typeof transactionHash !== "string") {
        return badRequestError("Transaction hash is required.");
      }

      const { id } = await context.params;
      const result = await markPaymentRequestPaid(id, transactionHash);

      if (!result.success) {
        return badRequestError(result.error || "Failed to mark payment request as paid.");
      }

      return successResponse(result.request);
    } catch (err) {
      return handleApiError(err, "POST /api/requests/[id]/pay");
    }
  })
);
