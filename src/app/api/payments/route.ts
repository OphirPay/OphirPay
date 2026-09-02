// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  successResponse,
  validationError,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { incMetric } from "@/lib/metrics-counters";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  buildCursorWhere,
  computeNextCursor,
  decodeCursor,
  prismaPagination,
} from "@/lib/pagination-utils";

export const GET = withMetrics("GET /api/payments", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const explicitPage = searchParams.get("page");
    // `?? undefined` matters: searchParams.get() returns null for absent
    // params, and the schema's defaults/optionals only apply to undefined.
    const parsed = paginationSchema.safeParse({
      page: explicitPage ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, status, search, cursor: rawCursor } = parsed.data;

    // Soft-deleted rows are hidden by default (issue #50). `includeDeleted`
    // is the explicit admin/debug opt-in to see them — it never crosses user
    // boundaries, the result is still scoped to the authenticated user.
    const includeDeleted = searchParams.get("includeDeleted") === "true";

    // Always scope to the authenticated user — never expose other users' data.
    // `status` and `search` (memo ILIKE + exact tx-hash, Issue #157) use the
    // shared helper so the list route and CSV export stay in lockstep.
    const baseWhere = buildPaymentWhere(auth.userId, { status, search });
    // Soft-deleted rows are hidden by default (issue #50). `includeDeleted` is
    // the explicit admin/debug opt-in to see them.
    if (!includeDeleted) baseWhere.deletedAt = null;

    // Keyset (cursor) pagination is the default for plain list requests — it
    // never deep-skips, so later pages stay fast as the table grows. Offset
    // pagination via an explicit `page` param is kept for legacy consumers.
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return badRequestError("Invalid cursor");
    }

    const useCursor = cursor !== null || explicitPage === null;
    const where = buildCursorWhere(baseWhere, cursor);

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Fetch one extra row to learn whether another page exists.
        ...(useCursor ? { take: limit + 1 } : prismaPagination(page, limit)),
      }),
      prisma.payment.count({ where: baseWhere }),
    ]);

    logger.request("GET", `/api/payments?page=${page}&limit=${limit}`, 200, 0);

    const visible = useCursor ? payments.slice(0, limit) : payments;
    const pageInfo = useCursor
      ? computeNextCursor(payments, limit)
      : { nextCursor: null, hasMore: page * limit < total };

    return successResponse(visible, {
      page,
      limit,
      total,
      nextCursor: pageInfo.nextCursor,
      hasMore: pageInfo.hasMore,
    });
  } catch (err) {
    return handleApiError(err, `GET /api/payments/[id]`);
  }
}));

export const POST = withMetrics("POST /api/payments", withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const parsed = await validateIdParam(params);
    if (!parsed.success) return parsed.response;
    const { id } = parsed;

    const body = await request.json() as { status?: string; description?: string; memo?: string };

    // updateMany scopes the write to the authenticated user's records
    const updated = await prisma.payment.updateMany({
      where: { id, userId: auth.userId },
      data: {
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        assetIssuer: parsed.data.assetIssuer,
        description: parsed.data.description,
        memo: parsed.data.memo,
        // Server-generated idempotency key — every attempt (original or
        // retried) carries its own key, so attempts are never confused.
        idempotencyKey: crypto.randomUUID(),
        status: "CREATED",
        // The authenticated user owns the record; sourceAccountId is a
        // Stellar account reference, NOT the User FK (previously this
        // wrote a Stellar address into userId, breaking the relation).
        userId: auth.userId,
        sourceAccountId: parsed.data.sourceAccountId,
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
}));
