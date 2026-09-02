// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { updateScheduledPaymentSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  notFoundError,
  badRequestError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";

const UNAUTHORIZED_MESSAGE =
  "Authentication required. Connect your wallet or provide an API key.";

/**
 * Fetch the scheduled payment scoped to the authenticated user.
 * Returns { payment, error } so callers can short-circuit on error.
 */
async function getUserScheduledPayment(request: Request, id: string) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return { payment: null, error: unauthorizedError(UNAUTHORIZED_MESSAGE) };
  }

  const payment = await prisma.scheduledPayment.findUnique({ where: { id } });
  if (!payment || payment.userId !== auth.userId) {
    return { payment: null, error: notFoundError("Scheduled payment") };
  }

  return { payment, error: null };
}

/** GET /api/scheduled/[id] — return a single scheduled payment. */
export const GET = withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { payment, error } = await getUserScheduledPayment(request, id);
    if (error) return error;

    return successResponse({
      ...payment,
      amount: payment.amount.toString(),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/scheduled/[id]");
  }
});

/** PATCH /api/scheduled/[id] — edit an upcoming scheduled payment. */
export const PATCH = withRequestLogging(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { payment, error } = await getUserScheduledPayment(request, id);
    if (error) return error;

    if (payment.status !== "SCHEDULED") {
      return badRequestError("Only SCHEDULED payments can be edited");
    }

    const body = await request.json();
    const parsed = updateScheduledPaymentSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const updateData: Record<string, unknown> = {};
    if (parsed.data.amount !== undefined) updateData.amount = parsed.data.amount;
    if (parsed.data.assetCode !== undefined)
      updateData.assetCode = parsed.data.assetCode;
    if (parsed.data.assetIssuer !== undefined)
      updateData.assetIssuer = parsed.data.assetIssuer;
    if (parsed.data.destAddress !== undefined)
      updateData.destAddress = parsed.data.destAddress;
    if (parsed.data.memo !== undefined) updateData.memo = parsed.data.memo;
    if (parsed.data.scheduledFor !== undefined)
      updateData.scheduledFor = new Date(parsed.data.scheduledFor);

    const updated = await prisma.scheduledPayment.update({
      where: { id },
      data: updateData,
    });

    logger.info("Scheduled payment updated", {
      id,
      changes: Object.keys(updateData),
    });

    return successResponse({
      ...updated,
      amount: updated.amount.toString(),
    });
  } catch (err) {
    return handleApiError(err, "PATCH /api/scheduled/[id]");
  }
});

/** DELETE /api/scheduled/[id] — cancel an upcoming scheduled payment. */
export const DELETE = withRequestLogging(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { payment, error } = await getUserScheduledPayment(request, id);
    if (error) return error;

    if (payment.status !== "SCHEDULED") {
      return badRequestError("Only SCHEDULED payments can be cancelled");
    }

    const updated = await prisma.scheduledPayment.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    logger.info("Scheduled payment cancelled", { id });

    return successResponse({
      ...updated,
      amount: updated.amount.toString(),
    });
  } catch (err) {
    return handleApiError(err, "DELETE /api/scheduled/[id]");
  }
});
