// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { formatProblemDetails, zodToProblemErrors } from "@/lib/api-errors";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { successResponse, handleApiError } from "@/lib/api-response";
import { createPaymentSchema, paginationSchema } from "@/lib/validation-schemas";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { incMetric } from "@/lib/metrics-counters";
import { buildPaymentWhere } from "@/lib/payment-filters";
import { invalidateCaches } from "@/lib/api-cache";
import { buildCursorWhere, computeNextCursor, computePagination, decodeCursor, prismaPagination } from "@/lib/pagination-utils";

function problemResponse(title: string, status: number, detail: string, instance: string, errors?: Record<string, string[]>) {
  const problem = formatProblemDetails({ title, status, detail, instance, errors });
  return new Response(JSON.stringify(problem), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export const GET = withMetrics("GET /api/payments", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return problemResponse("Unauthorized", 401, "Authentication required. Connect your wallet or provide an API key.", request.url);
    }
    const { searchParams } = new URL(request.url);
    const explicitPage = searchParams.get("page");
    const parsed = paginationSchema.safeParse({
      page: explicitPage ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) {
      return problemResponse("Validation Error", 400, "Invalid query parameters", request.url, zodToProblemErrors(parsed.error));
    }
    const { page, limit, status, search, cursor: rawCursor } = parsed.data;
    const includeDeleted = searchParams.get("includeDeleted") === "true";
    const baseWhere = buildPaymentWhere(auth.userId, { status, search });
    if (!includeDeleted) baseWhere.deletedAt = null;
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return problemResponse("Bad Request", 400, "Invalid cursor", request.url);
    }
    if (cursor !== null && explicitPage !== null) {
      return problemResponse("Bad Request", 400, "page and cursor cannot both be used", request.url);
    }
    if (cursor !== null || explicitPage === null) {
      const where = buildCursorWhere(baseWhere, cursor);
      const rows = await prisma.payment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
      const visible = rows.slice(0, limit);
      const { nextCursor, hasMore } = computeNextCursor(rows, limit);
      const meta: Record<string, unknown> = { limit, nextCursor, hasMore };
      if (searchParams.get("includeTotal") === "true") {
        meta.total = await prisma.payment.count({ where: baseWhere });
      }
      return successResponse(visible, meta);
    }
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({ where: baseWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...prismaPagination(page, limit) }),
      prisma.payment.count({ where: baseWhere }),
    ]);
    return successResponse(payments, { ...computePagination(page, limit, total), nextCursor: null, hasMore: page * limit < total });
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
      return problemResponse("Unauthorized", 401, "Authentication required. Connect your wallet or provide an API key.", request.url);
    }
    const body = await request.json();
    const parsed = createPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse("Validation Error", 400, "Invalid payment payload", request.url, zodToProblemErrors(parsed.error));
    }
    const payment = await prisma.payment.create({
      data: {
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        assetIssuer: parsed.data.assetIssuer,
        description: parsed.data.description,
        memo: parsed.data.memo,
        idempotencyKey: crypto.randomUUID(),
        status: "CREATED",
        userId: auth.userId,
        sourceAccountId: parsed.data.sourceAccountId,
      },
    });
    logger.info("Payment created", { id: payment.id, amount: payment.amount });
    dispatchWebhookEventAsync(WEBHOOK_EVENTS.PAYMENT_CREATED, { paymentId: payment.id, amount: payment.amount, assetCode: payment.assetCode, status: payment.status, createdAt: payment.createdAt.toISOString() }, auth.userId);
    incMetric("payments_created_total");
    await invalidateCaches([{ scope: "stats" }, { scope: "analytics", subject: auth.userId }, { scope: "audit-log" }]);
    return successResponse(payment, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/payments");
  }
}));