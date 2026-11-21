// SPDX-License-Identifier: MIT
import { z } from "zod";

import {
  problemBadRequest,
  problemFromError,
  problemFromLegacyResponse,
  problemFromZodError,
  problemNotFound,
  problemUnauthorized,
} from "@/lib/api-errors";
import { successResponse } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { withMetrics } from "@/lib/metrics-middleware";
import prisma from "@/lib/prisma";
import { withRequestLogging } from "@/lib/request-logging";

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
  const instance = new URL(request.url).pathname;
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return problemFromLegacyResponse(csrfError, instance);

    const auth = await getAuthContext(request);
    if (!auth) {
      return problemUnauthorized(undefined, { instance });
    }

    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      return problemBadRequest("Request body must be valid JSON", { instance });
    }
    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) return problemFromZodError(parsed.error, { instance });
    const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return problemNotFound("Payment", { instance });

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return problemNotFound("Payment", { instance });

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return problemFromError(err, instance);
  }
}));
