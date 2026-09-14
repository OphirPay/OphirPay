// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { createRecurrenceSchema, paginationSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { z } from "zod";

const updateRecurrenceSchema = z.object({
  id: z.string().min(1),
  paused: z.boolean(),
});

export const GET = withMetrics("GET /api/recurring", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = paginationSchema.safeParse({
      page: searchParams.get("page"),
      limit: searchParams.get("limit"),
    });
    if (!parsed.success) return validationError(parsed.error);

    const { page, limit } = parsed.data;
    const where = { userId: auth.userId };
    const [recurrences, total] = await Promise.all([
      prisma.recurrence.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { payments: { take: 5, orderBy: { createdAt: "desc" } } },
      }),
      prisma.recurrence.count({ where }),
    ]);

    return successResponse(recurrences, { page, limit, total });
  } catch (err) {
    return handleApiError(err, "GET /api/recurring");
  }
}));

export const POST = withMetrics("POST /api/recurring", withRequestLogging(async function POST(request: Request) {
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
    const parsed = createRecurrenceSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const nextRunAt = new Date();
    switch (parsed.data.frequency) {
      case "DAILY": nextRunAt.setDate(nextRunAt.getDate() + 1); break;
      case "WEEKLY": nextRunAt.setDate(nextRunAt.getDate() + 7); break;
      case "BIWEEKLY": nextRunAt.setDate(nextRunAt.getDate() + 14); break;
      case "MONTHLY": nextRunAt.setMonth(nextRunAt.getMonth() + 1); break;
      case "QUARTERLY": nextRunAt.setMonth(nextRunAt.getMonth() + 3); break;
      case "YEARLY": nextRunAt.setFullYear(nextRunAt.getFullYear() + 1); break;
    }

    const recurrence = await prisma.recurrence.create({
      data: {
        name: parsed.data.name,
        frequency: parsed.data.frequency,
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        destAddress: parsed.data.destAddress,
        description: parsed.data.description,
        nextRunAt,
        userId: auth.userId,
      },
    });

    logger.info("Recurring payment created", { id: recurrence.id });
    return successResponse(recurrence, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/recurring");
  }
}));

export const PATCH = withMetrics("PATCH /api/recurring", withRequestLogging(async function PATCH(request: Request) {
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
    const parsed = updateRecurrenceSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const { id, paused } = parsed.data;
    const existing = await prisma.recurrence.findFirst({
      where: { id, userId: auth.userId },
    });

    if (!existing) {
      return new Response(JSON.stringify({ error: "Recurrence not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const recurrence = await prisma.recurrence.update({
      where: { id },
      data: { isActive: !paused },
    });

    logger.info("Recurring payment updated", { id: recurrence.id, paused });
    return successResponse(recurrence);
  } catch (err) {
    return handleApiError(err, "PATCH /api/recurring");
  }
}));
