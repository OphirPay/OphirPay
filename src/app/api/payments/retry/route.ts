// SPDX-License-Identifier: MIT

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { retryPaymentSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  notFoundError,
  conflictError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";

/**
 * POST /api/payments/retry
 *
 * Retries a failed payment in place (issue #159): the original amount,
 * recipient and memo are reused — they live on the row — and the attempt is
 * stamped with a NEW idempotency key so the previous failed attempt is never
 * duplicated. The row returns to PENDING and flows through the normal submit
 * path (PENDING → SIGNED → SUBMITTED → … → COMPLETED) via the existing PATCH
 * transitions, which fire their usual webhooks.
 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = retryPaymentSchema.safeParse(body ?? {});
    if (!parsed.success) return validationError(parsed.error);

    const { id } = parsed.data;

    // Owner-scoped lookup — no IDOR across users; soft-deleted payments are
    // not retryable (they behave like they don't exist, consistent with #50).
    const payment = await prisma.payment.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundError("Payment");

    if (payment.status !== "FAILED") {
      return conflictError(
        `Only failed payments can be retried (current status: ${payment.status})`
      );
    }

    // updateMany scopes the write to the authenticated user's records. The
    // row is reused — no new row is created, so the failed attempt is never
    // duplicated. A fresh idempotency key marks this as a new attempt; the
    // stale failure details are cleared for the next submit cycle.
    const updated = await prisma.payment.updateMany({
      where: { id, userId: auth.userId },
      data: {
        status: "PENDING",
        errorMessage: null,
        transactionHash: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    if (updated.count === 0) return notFoundError("Payment");

    const retried = await prisma.payment.findUnique({ where: { id } });
    if (!retried) return notFoundError("Payment");

    logger.info("Payment retried", {
      id,
      previousStatus: payment.status,
      newStatus: retried.status,
    });

    return successResponse(retried);
  } catch (err) {
    return handleApiError(err, "POST /api/payments/retry");
  }
}
