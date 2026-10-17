// SPDX-License-Identifier: MIT

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { retryPaymentSchema } from "@/lib/validation-schemas";
import { successResponse } from "@/lib/api-response";
import {
  problemBadRequest,
  problemConflict,
  problemFromError,
  problemFromLegacyResponse,
  problemFromZodError,
  problemNotFound,
  problemUnauthorized,
} from "@/lib/api-errors";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";

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
  const instance = new URL(request.url).pathname;
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return problemFromLegacyResponse(csrfError, instance);

    const auth = await getAuthContext(request);
    if (!auth) {
      return problemUnauthorized(undefined, { instance });
    }

    const body = await request.json().catch(() => null);
    if (body === null) {
      return problemBadRequest("Request body must be valid JSON", { instance });
    }
    // `?? {}` keeps the schema's own error ("Payment id is required") for a
    // valid JSON body that simply omits the field.
    const parsed = retryPaymentSchema.safeParse(body ?? {});
    if (!parsed.success) return problemFromZodError(parsed.error, { instance });

    const { id } = parsed.data;

    // Owner-scoped lookup — no IDOR across users; soft-deleted payments are
    // not retryable (they behave like they don't exist, consistent with #50).
    const payment = await prisma.payment.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return problemNotFound("Payment", { instance });

    if (payment.status !== "FAILED") {
      return problemConflict(
        `Only failed payments can be retried (current status: ${payment.status})`,
        { instance, code: "STATE_CONFLICT" }
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
    if (updated.count === 0) return problemNotFound("Payment", { instance });

    const retried = await prisma.payment.findUnique({ where: { id } });
    if (!retried) return problemNotFound("Payment", { instance });

    logger.info("Payment retried", {
      id,
      previousStatus: payment.status,
      newStatus: retried.status,
    });

    return successResponse(retried);
  } catch (err) {
    return problemFromError(err, instance);
  }
}
