// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { createPaymentSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { incMetric } from "@/lib/metrics-counters";

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : 20;
    const cursor = searchParams.get("cursor") || undefined;
    const pageParam = searchParams.get("page");
    const page = pageParam ? Math.max(parseInt(pageParam, 10) || 1, 1) : undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    // Always scope to the authenticated user — never expose other users' data
    const where: Record<string, unknown> = { userId: auth.userId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { description: { contains: search } },
        { memo: { contains: search } },
        { transactionHash: { contains: search } },
      ];
    }

    type PaymentItem = Awaited<ReturnType<typeof prisma.payment.findMany>>[number];
    let payments: PaymentItem[];
    let nextCursor: string | null = null;
    let hasMore = false;
    let total: number | undefined;

    if (cursor) {
      // Keyset cursor pagination
      const items = await prisma.payment.findMany({
        where,
        take: limit + 1,
        cursor: { id: cursor },
        skip: 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      hasMore = items.length > limit;
      payments = hasMore ? items.slice(0, limit) : items;
      nextCursor = hasMore && payments.length > 0 ? payments[payments.length - 1].id : null;
    } else if (page !== undefined) {
      // Offset pagination fallback
      const [pagedItems, count] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit + 1,
        }),
        prisma.payment.count({ where }),
      ]);
      total = count;
      hasMore = pagedItems.length > limit;
      payments = hasMore ? pagedItems.slice(0, limit) : pagedItems;
      nextCursor = hasMore && payments.length > 0 ? payments[payments.length - 1].id : null;
    } else {
      // First page cursor query
      const items = await prisma.payment.findMany({
        where,
        take: limit + 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      hasMore = items.length > limit;
      payments = hasMore ? items.slice(0, limit) : items;
      nextCursor = hasMore && payments.length > 0 ? payments[payments.length - 1].id : null;
    }

    logger.request("GET", `/api/payments?limit=${limit}&cursor=${cursor || ""}`, 200, 0);

    return successResponse(payments, {
      limit,
      cursor: cursor || null,
      nextCursor,
      hasMore,
      ...(total !== undefined && { total, page: page || 1 }),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/payments");
  }
}

export async function POST(request: Request) {
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

    const payment = await prisma.payment.create({
      data: {
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        assetIssuer: parsed.data.assetIssuer,
        description: parsed.data.description,
        memo: parsed.data.memo,
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
}
