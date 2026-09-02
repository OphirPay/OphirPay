// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  createScheduledPaymentSchema,
  paginationSchema,
} from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  badRequestError,
  notFoundError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";

const UNAUTHORIZED_MESSAGE =
  "Authentication required. Connect your wallet or provide an API key.";

/** List the authenticated user's scheduled payments, soonest first. */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError(UNAUTHORIZED_MESSAGE);

    const { searchParams } = new URL(request.url);
    const parsed = paginationSchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit } = parsed.data;
    const where = { userId: auth.userId };
    const [payments, total] = await Promise.all([
      prisma.scheduledPayment.findMany({
        where,
        orderBy: { scheduledFor: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.scheduledPayment.count({ where }),
    ]);

    // jsonSafe mangles Prisma Decimal instances ({s,e,d} internals), so
    // serialize amounts as strings explicitly.
    return successResponse(
      payments.map((p) => ({ ...p, amount: p.amount.toString() })),
      { page, limit, total }
    );
  } catch (err) {
    return handleApiError(err, "GET /api/scheduled");
  }
});

/** Create a scheduled payment. The date must be in the future. */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError(UNAUTHORIZED_MESSAGE);

    const body = await request.json();
    const parsed = createScheduledPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const payment = await prisma.scheduledPayment.create({
      data: {
        userId: auth.userId,
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        assetIssuer: parsed.data.assetIssuer,
        destAddress: parsed.data.destAddress,
        memo: parsed.data.memo,
        scheduledFor: new Date(parsed.data.scheduledFor),
      },
    });

    logger.info("Scheduled payment created", { id: payment.id });
    return successResponse({ ...payment, amount: payment.amount.toString() }, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/scheduled");
  }
});

/** Cancel a scheduled payment that has not been executed yet. */
export const DELETE = withRequestLogging(async function DELETE(
  request: Request
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError(UNAUTHORIZED_MESSAGE);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return badRequestError("Scheduled payment id is required");

    // updateMany scopes the write to the user's own records and only cancels
    // rows still awaiting execution.
    const updated = await prisma.scheduledPayment.updateMany({
      where: { id, userId: auth.userId, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return notFoundError("Scheduled payment");

    logger.info("Scheduled payment cancelled", { id });
    return successResponse({ id, status: "CANCELLED" });
  } catch (err) {
    return handleApiError(err, "DELETE /api/scheduled");
  }
});
