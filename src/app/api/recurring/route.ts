// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
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
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_recurring",
      CHAIN_READ_SOURCE,
      [nativeToScVal(recurringId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Recurring payment ${id} not found`);
    }

    return successResponse(result.returnValue);
  } catch (err) {
    return handleApiError(err, "GET /api/recurring/[id]");
  }
}));

export async function PATCH(request: Request) {
  try {
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
}