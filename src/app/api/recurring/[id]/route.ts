// SPDX-License-Identifier: MIT

/**
 * Recurring payment single-resource routes.
 *
 * Addresses issue #173: scheduled payments can be edited (amount/date)
 * or cancelled before execution.
 */

import prisma from "@/lib/prisma";
import { z } from "zod";
import { successResponse, validationError, unauthorizedError, notFoundError, handleApiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";

const updateRecurrenceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  amount: z.number().positive().optional(),
  assetCode: z.string().min(1).max(12).optional(),
  destAddress: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  frequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
  nextRunAt: z.string().datetime().optional(),
});

async function getAuthAndRecurrence(request: Request, id: string) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return { auth: null, recurrence: null, error: unauthorizedError("Authentication required.") };
  }

  const recurrence = await prisma.recurrence.findUnique({ where: { id } });
  if (!recurrence) {
    return { auth, recurrence: null, error: notFoundError("Recurrence not found") };
  }
  if (recurrence.userId !== auth.userId) {
    return { auth, recurrence: null, error: unauthorizedError("Not authorized to access this recurrence") };
  }

  return { auth, recurrence, error: null };
}

/** GET /api/recurring/[id] */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { recurrence, error } = await getAuthAndRecurrence(request, params.id);
    if (error) return error;
    return successResponse(recurrence);
  } catch (err) {
    return handleApiError(err, "GET /api/recurring/[id]");
  }
}

/** PATCH /api/recurring/[id] — Edit a scheduled payment before execution */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { recurrence, error } = await getAuthAndRecurrence(request, params.id);
    if (error) return error;

    if (recurrence.status === "CANCELLED" || recurrence.status === "COMPLETED") {
      return validationError({ issues: [{ message: "Cannot edit a cancelled or completed recurrence", path: ["status"] }] });
    }

    const body = await request.json();
    const parsed = updateRecurrenceSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.amount !== undefined) updateData.amount = parsed.data.amount;
    if (parsed.data.assetCode !== undefined) updateData.assetCode = parsed.data.assetCode;
    if (parsed.data.destAddress !== undefined) updateData.destAddress = parsed.data.destAddress;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.frequency !== undefined) updateData.frequency = parsed.data.frequency;
    if (parsed.data.nextRunAt !== undefined) updateData.nextRunAt = new Date(parsed.data.nextRunAt);

    const updated = await prisma.recurrence.update({
      where: { id: params.id },
      data: updateData,
    });

    logger.info("Recurring payment updated", { id: params.id, changes: Object.keys(updateData) });
    return successResponse(updated);
  } catch (err) {
    return handleApiError(err, "PATCH /api/recurring/[id]");
  }
}

/** DELETE /api/recurring/[id] — Cancel a scheduled payment before execution */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { recurrence, error } = await getAuthAndRecurrence(request, params.id);
    if (error) return error;

    if (recurrence.status === "CANCELLED" || recurrence.status === "COMPLETED") {
      return validationError({ issues: [{ message: "Recurrence is already cancelled or completed", path: ["status"] }] });
    }

    const cancelled = await prisma.recurrence.update({
      where: { id: params.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    logger.info("Recurring payment cancelled", { id: params.id });
    return successResponse(cancelled);
  } catch (err) {
    return handleApiError(err, "DELETE /api/recurring/[id]");
  }
}
