// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  notFoundError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;
    // Only the owning user may read the payment (no IDOR across users), and
    // soft-deleted payments behave like they don't exist (consistent 404).
    const payment = await prisma.payment.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundError("Payment");
    return successResponse(payment);
  } catch (err) {
    return handleApiError(err, `GET /api/payments/[id]`);
  }
});

export const PATCH = withRequestLogging(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;
    const body = await request.json() as { status?: string; description?: string; memo?: string };

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
    if (updated.count === 0) return notFoundError("Payment");

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return notFoundError("Payment");

    logger.info("Payment updated", { id, status: payment.status });

    if (body.status === "SIGNED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_SIGNED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        status: payment.status,
        signedAt: new Date().toISOString(),
      });
    } else if (body.status === "SUBMITTED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_SUBMITTED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        submittedAt: new Date().toISOString(),
      });
    } else if (body.status === "CONFIRMED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_CONFIRMED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        confirmedAt: new Date().toISOString(),
      });
    } else if (body.status === "COMPLETED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_COMPLETED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash: payment.transactionHash,
        completedAt: payment.completedAt?.toISOString() ?? new Date().toISOString(),
      });
    } else if (body.status === "FAILED") {
      dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_FAILED, {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        errorMessage: payment.errorMessage,
        failedAt: new Date().toISOString(),
      });
    }

    return successResponse(payment);
  } catch (err) {
    return handleApiError(err, `PATCH /api/payments/[id]`);
  }
});

export const DELETE = withRequestLogging(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
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
    if (deleted.count === 0) return notFoundError("Payment");
    logger.info("Payment soft-deleted", { id });
    return successResponse({ deleted: true });
  } catch (err) {
    return handleApiError(err, `DELETE /api/payments/[id]`);
  }
});
