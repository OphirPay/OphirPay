// SPDX-License-Identifier: MIT

import {
  problemBadRequest,
  problemFromError,
  problemFromZodError,
  problemUnauthorized,
} from "@/lib/api-errors";
import { successResponse } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withMetrics } from "@/lib/metrics-middleware";
import {
  buildCursorWhere,
  computeNextCursor,
  computePagination,
  decodeCursor,
  prismaPagination,
} from "@/lib/pagination-utils";
import { buildPaymentWhere } from "@/lib/payment-filters";
import prisma from "@/lib/prisma";
import { withRequestLogging } from "@/lib/request-logging";
import { transactionPaginationSchema } from "@/lib/validation-schemas";

/**
 * GET /api/transactions
 *
 * Transaction history route with enforced pagination limit cap (issue #1953).
 * Limits queries between 1 and 100 (default 20) to prevent unbounded DB queries.
 */
export const GET = withMetrics(
  "GET /api/transactions",
  withRequestLogging(async function GET(request: Request) {
    const instance = new URL(request.url).pathname;
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return problemUnauthorized(undefined, { instance });
      }

      const { searchParams } = new URL(request.url);
      const explicitPage = searchParams.get("page");
      const parsed = transactionPaginationSchema.safeParse({
        page: explicitPage ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        search: searchParams.get("search") ?? undefined,
      });

      if (!parsed.success) {
        return problemFromZodError(parsed.error, { instance });
      }

      const { page, limit, status, search, cursor: rawCursor } = parsed.data;

      const includeDeleted = searchParams.get("includeDeleted") === "true";
      const baseWhere = buildPaymentWhere(auth.userId, { status, search });
      if (!includeDeleted) {
        baseWhere.deletedAt = null;
      }

      const cursor = rawCursor ? decodeCursor(rawCursor) : null;
      if (rawCursor && !cursor) {
        return problemBadRequest("Invalid cursor", {
          instance,
          code: "INVALID_CURSOR",
        });
      }
      if (cursor !== null && explicitPage !== null) {
        return problemBadRequest("page and cursor cannot both be used", {
          instance,
        });
      }

      // Keyset mode (default)
      if (cursor !== null || explicitPage === null) {
        const where = buildCursorWhere(baseWhere, cursor);
        const rows = await prisma.payment.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        });
        const visible = rows.slice(0, limit);
        const { nextCursor, hasMore } = computeNextCursor(rows, limit);
        const meta: Record<string, unknown> = { limit, nextCursor, hasMore };
        if (searchParams.get("includeTotal") === "true") {
          meta.total = await prisma.payment.count({ where: baseWhere });
        }
        return successResponse(visible, meta);
      }

      // Offset mode
      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where: baseWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...prismaPagination(page, limit),
        }),
        prisma.payment.count({ where: baseWhere }),
      ]);

      return successResponse(payments, {
        ...computePagination(page, limit, total),
        nextCursor: null,
        hasMore: page * limit < total,
      });
    } catch (err) {
      return problemFromError(err, instance);
    }
  })
);
