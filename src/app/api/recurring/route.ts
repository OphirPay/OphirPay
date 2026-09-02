// SPDX-License-Identifier: MIT

/**
 * Recurring payment collection routes.
 */

import prisma from "@/lib/prisma";
import { createRecurringSchema, paginationSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { withMetrics } from "@/lib/metrics-middleware";
import { nextRunAt } from "@/lib/recurrence";

/** GET /api/recurring — list the authenticated user's recurring payments */
export const GET = withMetrics(
  "GET /api/recurring",
  withRequestLogging(async function GET(request: Request) {
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

      return successResponse(
        recurrences.map((r) => ({ ...r, amount: r.amount.toString() })),
        { page, limit, total }
      );
    } catch (err) {
      return handleApiError(err, "GET /api/recurring");
    }
  })
);

/** POST /api/recurring — create a new recurring payment */
export const POST = withMetrics(
  "POST /api/recurring",
  withRequestLogging(async function POST(request: Request) {
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
      const parsed = createRecurringSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);

      const nextRunAtDate = nextRunAt(new Date(), parsed.data.frequency);

      const recurrence = await prisma.recurrence.create({
        data: {
          userId: auth.userId,
          name: parsed.data.name,
          frequency: parsed.data.frequency,
          amount: parsed.data.amount,
          assetCode: parsed.data.assetCode,
          assetIssuer: parsed.data.assetIssuer,
          destAddress: parsed.data.destAddress,
          description: parsed.data.description,
          nextRunAt: nextRunAtDate,
        },
      });

      logger.info("Recurring payment created", { id: recurrence.id });
      return successResponse({ ...recurrence, amount: recurrence.amount.toString() }, undefined, 201);
    } catch (err) {
      return handleApiError(err, "POST /api/recurring");
    }
  })
);
