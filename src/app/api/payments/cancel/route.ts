// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";
import {
  problemResponse,
  zodValidationProblem,
  handlePaymentProblemError,
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
    if (csrfError) {
      return problemResponse(
        403,
        "Invalid or missing CSRF token. Refresh the page and try again."
      );
    }

    const auth = await getAuthContext(request);
    if (!auth) {
      return problemResponse(
        401,
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return problemResponse(400, "Invalid JSON body");
    }

    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) return zodValidationProblem(parsed.error);
    const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return problemResponse(404, "Payment not found");

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return problemResponse(404, "Payment not found");

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return handlePaymentProblemError(err, "POST /api/payments/cancel");
  }
}));
