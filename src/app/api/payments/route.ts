// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { createPaymentSchema, paginationSchema, idempotencyKeySchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  badRequestError,
  conflictError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { incMetric } from "@/lib/metrics-counters";
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

    // Always scope to the authenticated user — never expose other users' data
    const baseWhere: Record<string, unknown> = {
      userId: auth.userId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    };
    if (status) baseWhere.status = status;
    if (search) {
      baseWhere.OR = [
        { description: { contains: search } },
        { memo: { contains: search } },
        { transactionHash: { contains: search } },
      ];
    }

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
    return handleApiError(err, "GET /api/payments");
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

    const body = await request.json();
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    // Idempotency key (issue #548): the `Idempotency-Key` header takes
    // precedence over the optional body field.
    let idempotencyKey = parsed.data.idempotencyKey;
    const headerKey = request.headers.get("idempotency-key");
    if (headerKey !== null) {
      const headerCheck = idempotencyKeySchema.safeParse(headerKey);
      if (!headerCheck.success) {
        return validationError(headerCheck.error);
      }
      idempotencyKey = headerCheck.data;
    }

    // Re-submission of an already-processed payment: same user + same key means
    // no new payment. 
    if (idempotencyKey) {
      const existing = await prisma.payment.findFirst({
        where: { userId: auth.userId, idempotencyKey },
      });

      if (existing) {
        return successResponse(
          existing,
          { deduplicated: true, timestamp: new Date().toISOString() },
          200
        );
      }
    }

    let payment;
    try {
      payment = await prisma.payment.create({
        data: {
          amount: parsed.data.amount,
          assetCode: parsed.data.assetCode,
          assetIssuer: parsed.data.assetIssuer,
          description: parsed.data.description,
          memo: parsed.data.memo,
          // Server-generated when the client sends no key, so every payment
          // records an idempotency key. Deduplication only applies to
          // client-supplied keys, which retries actually re-send.
          idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
          status: "CREATED",
          // The authenticated user owns the record; sourceAccountId is a
          // Stellar account reference, NOT the User FK (previously this
          // wrote a Stellar address into userId, breaking the relation).
          userId: auth.userId,
          sourceAccountId: parsed.data.sourceAccountId,
        },
      });
    } catch (err) {
      const isUniqueConstraint = typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
      if (isUniqueConstraint && idempotencyKey) {
        // A concurrent request won the race with the same key
        const winner = await prisma.payment.findFirst({
          where: { userId: auth.userId, idempotencyKey },
        });
        if (winner) {
          return successResponse(
            winner,
            { deduplicated: true, timestamp: new Date().toISOString() },
            200
          );
        }
        return conflictError(
          "A payment with this idempotency key already exists but could not be recovered."
        );
      }
      throw err;
    }

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
