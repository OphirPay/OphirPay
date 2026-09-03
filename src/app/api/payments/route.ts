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
import { createPaymentSchema, paginationSchema } from "@/lib/validation-schemas";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { incMetric } from "@/lib/metrics-counters";
import { buildPaymentWhere } from "@/lib/payment-filters";
import {
  buildCursorWhere,
  computeNextCursor,
  computePagination,
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
    if (!includeDeleted) baseWhere.deletedAt = null;

    // Keyset (cursor) pagination is the default for plain list requests — it
    // never deep-skips, so later pages stay fast as the table grows. Offset
    // pagination via an explicit `page` param is kept for legacy consumers.
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return badRequestError("Invalid cursor");
    }
    if (cursor !== null && explicitPage !== null) {
      return badRequestError("page and cursor cannot both be used");
    }

    // Keyset mode (default): fetch limit + 1 rows to learn whether another
    // page exists. The COUNT is expensive, so it only runs when the caller
    // explicitly asks for meta.total via includeTotal=true.
    if (cursor !== null || explicitPage === null) {
      const where = buildCursorWhere(baseWhere, cursor);
      const rows = await prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Fetch one extra row to learn whether another page exists.
        take: limit + 1,
      });
      const visible = rows.slice(0, limit);
      const { nextCursor, hasMore } = computeNextCursor(rows, limit);
      const meta: Record<string, unknown> = { limit, nextCursor, hasMore };
      if (searchParams.get("includeTotal") === "true") {
        meta.total = await prisma.payment.count({ where: baseWhere });
      }
      return successResponse(visible, meta);
    }

    // Legacy offset mode: an explicit `page` param. Needs the COUNT to build
    // the navigation meta (totalPages / hasNext / hasPrev).
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: baseWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...prismaPagination(page, limit),
      }),
      prisma.payment.count({ where: baseWhere }),
    ]);

    return successResponse(payments, {
      ...computePagination(page, limit, total),
      // Keyset-shaped fields kept for consumers that page via hasMore;
      // offset mode never returns a cursor.
      nextCursor: null,
      hasMore: page * limit < total,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments");
  }
}));

export const POST = withMetrics("POST /api/payments", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const body = await request.json();
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const payment = await prisma.payment.create({
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

    logger.info("Payment created", { id: payment.id, amount: payment.amount });

    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.PAYMENT_CREATED,
      {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
      },
      auth.userId
    );

    incMetric("payments_created_total");

    return successResponse(payment, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/payments");
  }
}));
