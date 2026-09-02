// SPDX-License-Identifier: MIT

/**
 * Recurring payment single-resource routes.
 *
 * Addresses issue #173: scheduled payments can be edited (amount/date)
 * or cancelled before execution.
 */

import prisma from "@/lib/prisma";
import {
  successResponse,
  validationError,
  unauthorizedError,
  notFoundError,
  badRequestError,
  handleApiError,
} from "@/lib/api-response";
import { updateRecurringSchema } from "@/lib/validation-schemas";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { withMetrics } from "@/lib/metrics-middleware";


async function getAuthAndRecurrence(request: Request, id: string) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return { auth: null, recurrence: null, error: unauthorizedError("Authentication required.") };
  }

  const recurrence = await prisma.recurrence.findUnique({ where: { id } });
  if (!recurrence) {
    return { auth, recurrence: null, error: notFoundError("Recurring payment not found") };
  }
  if (recurrence.userId !== auth.userId) {
    return { auth, recurrence: null, error: unauthorizedError("Not authorized to access this recurring payment") };
  }

  return { auth, recurrence, error: null };
}

/** GET /api/recurring/[id] — single recurring payment lookup */
export const GET = withMetrics(
  "GET /api/recurring/[id]",
  withRequestLogging(async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const { id } = await params;
      const { recurrence, error } = await getAuthAndRecurrence(request, id);
      if (error) return error;
      return successResponse({ ...recurrence, amount: recurrence.amount.toString() });
    } catch (err) {
      return handleApiError(err, "GET /api/recurring/[id]");
    }
  })
);

/** PATCH /api/recurring/[id] — edit a scheduled payment before execution */
export const PATCH = withMetrics(
  "PATCH /api/recurring/[id]",
  withRequestLogging(async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const { id } = await params;
      const { recurrence, error } = await getAuthAndRecurrence(request, id);
      if (error) return error;

      if (!recurrence.isActive) {
        return badRequestError("Cannot edit a cancelled recurring payment");
      }

      const body = await request.json();
      const parsed = updateRecurringSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const updateData: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.amount !== undefined) updateData.amount = parsed.data.amount;
      if (parsed.data.assetCode !== undefined) updateData.assetCode = parsed.data.assetCode;
      if (parsed.data.assetIssuer !== undefined) updateData.assetIssuer = parsed.data.assetIssuer;
      if (parsed.data.destAddress !== undefined) updateData.destAddress = parsed.data.destAddress;
      if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
      if (parsed.data.frequency !== undefined) updateData.frequency = parsed.data.frequency;
      if (parsed.data.nextRunAt !== undefined) updateData.nextRunAt = new Date(parsed.data.nextRunAt);

      if (Object.keys(updateData).length === 0) {
        return badRequestError("No valid fields provided for update");
      }

      const updated = await prisma.recurrence.update({
        where: { id },
        data: updateData,
      });

      logger.info("Recurring payment updated", { id, changes: Object.keys(updateData) });
      return successResponse({ ...updated, amount: updated.amount.toString() });
    } catch (err) {
      return handleApiError(err, "PATCH /api/recurring/[id]");
    }
  })
);

/** DELETE /api/recurring/[id] — cancel a scheduled payment before execution */
export const DELETE = withMetrics(
  "DELETE /api/recurring/[id]",
  withRequestLogging(async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const { id } = await params;
      const { recurrence, error } = await getAuthAndRecurrence(request, id);
      if (error) return error;

      if (!recurrence.isActive) {
        return badRequestError("Recurring payment is already cancelled");
      }

      const cancelled = await prisma.recurrence.update({
        where: { id },
        data: { isActive: false },
      });

      logger.info("Recurring payment cancelled", { id });
      return successResponse({ ...cancelled, amount: cancelled.amount.toString() });
    } catch (err) {
      return handleApiError(err, "DELETE /api/recurring/[id]");
    }
  })
);
