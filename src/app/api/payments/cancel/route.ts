// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  handleApiError,
} from "@/lib/api-response";
import {
  validationProblem,
  unauthorizedProblem,
  notFoundProblem,
} from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { z } from "zod";

const cancelPaymentSchema = z.object({
  txHash: z.string().min(1, "Transaction hash is required"),
});

/**
 * POST /api/payments/cancel — soft-cancel a payment (Issue #47).
 *
 * Marks a payment as CANCELLED so the UI can display the status change
 * optimistically while the server confirms.
 */
export const POST = withMetrics("POST /api/payments/cancel", withRequestLogging(async function POST(
  request: Request
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblem(
              "Authentication required. Connect your wallet or provide an API key."
            );
    }

    const rawBody = await request.json();
    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) return validationProblem(parsed.error);
        const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return notFoundProblem("Payment");

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundProblem("Payment");

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return handleApiError(err, "POST /api/payments/cancel");
  }
}));
