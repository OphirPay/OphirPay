// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { updatePaymentSchema } from "@/lib/validation-schemas";
import { successResponse } from "@/lib/api-response";
import {
  validationProblem,
  badRequestProblem,
  notFoundProblem,
  unauthorizedProblem,
  forbiddenProblem,
  handleProblemApiError,
} from "@/lib/api-errors";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateIdParam } from "@/lib/validate-params";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withMetrics("GET /api/payments/[id]", withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblem(
        "Authentication required. Connect your wallet or provide an API key.",
        "/api/payments/[id]"
      );
    }

    const parsedId = await validateIdParam(params);
    if (!parsedId.success) {
      return badRequestProblem(
        "Invalid ID format",
        "/api/payments/[id]",
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    const { id } = parsedId;
    // Only the owning user may read the payment (no IDOR across users), and
    // soft-deleted payments behave like they don't exist (consistent 404).
    const payment = await prisma.payment.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundProblem("Payment", `/api/payments/${id}`);
    return successResponse(payment);
  } catch (err) {
    return handleProblemApiError(err, `GET /api/payments/[id]`, "/api/payments/[id]");
  }
}));

export const PATCH = withMetrics("PATCH /api/payments/[id]", withRequestLogging(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) {
      return forbiddenProblem(
        "Invalid or missing CSRF token. Refresh the page and try again.",
        "/api/payments/[id]",
        "CSRF_INVALID"
      );
    }

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblem(
        "Authentication required. Connect your wallet or provide an API key.",
        "/api/payments/[id]"
      );
    }

    const { id } = await params;
    const instance = `/api/payments/${id}`;
    const rawBody = await request.json();
    // Validate the whole update body (status enum, description, memo length /
    // charset) server-side so invalid memos never reach the database or the
    // webhook payloads.
    const parsed = updatePaymentSchema.safeParse(rawBody);
    if (!parsed.success) return validationProblem(parsed.error, instance);
    const body = parsed.data;

    // updateMany scopes the write to the authenticated user's records and
    // excludes soft-deleted payments (consistent 404, same as GET).
    const updated = await prisma.payment.updateMany({
      where: { id, userId: auth.userId, deletedAt: null },
      data: {
        ...(body.status && { status: body.status as never }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.memo !== undefined && { memo: body.memo }),
      },
    });
    if (updated.count === 0) return notFoundProblem("Payment", instance);

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return notFoundProblem("Payment", instance);

    logger.info("Payment updated", { id, status: payment.status });

    if (body.status === "SIGNED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_SIGNED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        status: payment.status,
        signedAt: new Date().toISOString(),
      }, auth.userId);
    } else if (body.status === "SUBMITTED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_SUBMITTED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        submittedAt: new Date().toISOString(),
      }, auth.userId);
    } else if (body.status === "CONFIRMED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_CONFIRMED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        confirmedAt: new Date().toISOString(),
      }, auth.userId);
    } else if (body.status === "COMPLETED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_COMPLETED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        completedAt: payment.completedAt?.toISOString() ?? new Date().toISOString(),
      }, auth.userId);
    } else if (body.status === "FAILED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_FAILED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        errorMessage: payment.errorMessage,
        failedAt: new Date().toISOString(),
      }, auth.userId);
    }

    return successResponse(payment);
  } catch (err) {
    return handleProblemApiError(err, `PATCH /api/payments/[id]`, "/api/payments/[id]");
  }
}));

export const DELETE = withMetrics("DELETE /api/payments/[id]", withRequestLogging(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) {
      return forbiddenProblem(
        "Invalid or missing CSRF token. Refresh the page and try again.",
        "/api/payments/[id]",
        "CSRF_INVALID"
      );
    }

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedProblem(
        "Authentication required. Connect your wallet or provide an API key.",
        "/api/payments/[id]"
      );
    }

    const { id } = await params;
    // Soft-delete: mark deletedAt instead of removing the row so audit trails
    // and analytics survive (issue #50). updateMany scopes the write to the
    // authenticated user's records (no IDOR across users).
    const deleted = await prisma.payment.updateMany({
      where: { id, userId: auth.userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (deleted.count === 0) return notFoundProblem("Payment", `/api/payments/${id}`);
    logger.info("Payment soft-deleted", { id });
    return successResponse({ deleted: true });
  } catch (err) {
    return handleProblemApiError(err, `DELETE /api/payments/[id]`, "/api/payments/[id]");
  }
}));
