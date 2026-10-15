// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";
import {
  validationProblem,
  codeProblem,
  problemFromResponse,
  handleApiErrorProblem,
} from "@/lib/api-errors";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { z } from "zod";

const INSTANCE = "/api/payments/cancel";

const cancelPaymentSchema = z.object({
  txHash: z.string().min(1, "Transaction hash is required"),
});

/**
 * POST /api/payments/cancel — soft-cancel a payment (Issue #47).
 *
 * Marks a payment as CANCELLED so the UI can display the status change
 * optimistically while the server confirms. Error responses are RFC 7807
 * problem+json (Issue #1364).
 */
export const POST = withMetrics("POST /api/payments/cancel", withRequestLogging(async function POST(
  request: Request
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return await problemFromResponse(csrfError, INSTANCE);

    const auth = await getAuthContext(request);
    if (!auth) {
      return codeProblem(
        ERROR_CODES.UNAUTHORIZED,
        "Authentication required. Connect your wallet or provide an API key.",
        401,
        INSTANCE
      );
    }

    const rawBody = await request.json();
    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) return validationProblem(parsed.error, INSTANCE);
    const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return codeProblem(ERROR_CODES.NOT_FOUND, "Payment not found", 404, INSTANCE);
    }

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) {
      return codeProblem(ERROR_CODES.NOT_FOUND, "Payment not found", 404, INSTANCE);
    }

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return await handleApiErrorProblem(err, "POST /api/payments/cancel", INSTANCE);
  }
}));
