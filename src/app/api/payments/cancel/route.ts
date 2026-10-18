// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse } from "@/lib/api-response";
import {
  validationProblemDetails,
  unauthorizedProblemDetails,
  notFoundProblemDetails,
  csrfProblemDetails,
  handleApiProblemError,
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
 * POST /api/payments/cancel — soft-cancel a payment (Issue #47, Issue #1364).
 *
 * Marks a payment as CANCELLED so the UI can display the status change
 * optimistically while the server confirms. Errors formatted per RFC 7807.
 */
export const POST = withMetrics("POST /api/payments/cancel", withRequestLogging(async function POST(
  request: Request
) {
  const instance = "/api/payments/cancel";
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfProblemDetails(instance);

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblemDetails(
        "Authentication required. Connect your wallet or provide an API key.",
        instance
      );
    }

    const rawBody = await request.json();
    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) return validationProblemDetails(parsed.error, instance);
    const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return notFoundProblemDetails("Payment", instance);

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundProblemDetails("Payment", instance);

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return handleApiProblemError(err, instance);
  }
}));
