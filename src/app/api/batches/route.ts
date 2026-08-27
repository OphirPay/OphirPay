// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { createBatchSchema, paginationSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { incMetric } from "@/lib/metrics-counters";
import {
  buildCursorWhere,
  computeNextCursor,
  decodeCursor,
  prismaPagination,
} from "@/lib/pagination-utils";

// ── GET /api/batches — List batches with pagination ──────────

export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const explicitPage = searchParams.get("page");
    // `?? undefined` matters: searchParams.get() returns null for absent
    // params, and the schema's defaults/optionals only apply to undefined.
    const parsed = paginationSchema.safeParse({
      page: explicitPage ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsed.success) return validationError(parsed.error);

    const { page, limit, status, search, cursor: rawCursor } = parsed.data;

    const baseWhere: Record<string, unknown> = { userId: auth.userId };
    if (status) baseWhere.status = status;
    if (search) {
      baseWhere.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    // Keyset (cursor) pagination is the default for plain list requests — it
    // never deep-skips, so later pages stay fast as the table grows. Offset
    // pagination via an explicit `page` param is kept for legacy consumers.
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return badRequestError("Invalid cursor");
    }

    const useCursor = cursor !== null || explicitPage === null;
    const where = buildCursorWhere(baseWhere, cursor);

    const [batches, total] = await Promise.all([
      prisma.batch.findMany({
        where,
        include: { payments: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // Fetch one extra row to learn whether another page exists.
        ...(useCursor ? { take: limit + 1 } : prismaPagination(page, limit)),
      }),
      prisma.batch.count({ where: baseWhere }),
    ]);

    const visible = useCursor ? batches.slice(0, limit) : batches;
    const pageInfo = useCursor
      ? computeNextCursor(batches, limit)
      : { nextCursor: null, hasMore: page * limit < total };

    return successResponse(visible, {
      page,
      limit,
      total,
      nextCursor: pageInfo.nextCursor,
      hasMore: pageInfo.hasMore,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/batches");
  }
});

// ── POST /api/batches — Create a new batch ──────────────────

export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const body = await request.json();

    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, description, recipients: payments } = parsed.data;
    const { userId } = auth;

    const batch = await prisma.batch.create({
      data: { name, description, userId },
    });

    // Create child payments — status is CREATED (not COMPLETED)
    await prisma.payment.createMany({
      data: payments.map((p) => ({
        amount: p.amount,
        assetCode: p.assetCode || "XLM",
        memo: p.memo || "",
        status: "CREATED",
        userId,
        batchId: batch.id,
      })),
    });

    const result = await prisma.batch.findUnique({
      where: { id: batch.id },
      include: { payments: true },
    });

    incMetric("batches_processed_total");

    return successResponse(result, { timestamp: new Date().toISOString() }, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/batches");
  }
});
