// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import type { PaymentStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createBatchSchema, idempotencyKeySchema, paginationSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  badRequestError,
  unauthorizedError,
  conflictError,
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

export const GET = withMetrics("GET /api/batches", withRequestLogging(async function GET(request: Request) {
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
}));

// ── POST /api/batches — Create a new batch (idempotent) ──────

const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** True when `err` is a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

/**
 * True for a Prisma P2002 (unique constraint) error. Detected by code rather
 * than `instanceof` so it also fires for the error shape serialized across
 * runtime boundaries, and it lets tests simulate the race cheaply.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

/** Shared shape for the child payments created with a batch. */
function paymentCreateData(
  payments: Array<{ amount: number; memo?: string; assetCode?: string }>,
  batchId: string,
  userId: string
) {
  return payments.map((p) => ({
    amount: p.amount,
    assetCode: p.assetCode || "XLM",
    memo: p.memo || "",
    // Child payments start as CREATED — they are never completed here.
    status: "CREATED" as PaymentStatus,
    userId,
    batchId,
  }));
}

async function fetchBatchWithPayments(batchId: string) {
  return prisma.batch.findUnique({
    where: { id: batchId },
    include: { payments: true },
  });
}

export const POST = withMetrics("POST /api/batches", withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const batch = result.returnValue as Record<string, unknown>;

    // Optionally include batch payments
    const { searchParams } = new URL(request.url);
    if (searchParams.get("payments") === "true") {
      const paymentsResult = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_payments_by_batch",
        CHAIN_READ_SOURCE,
        [nativeToScVal(batchId, { type: "u64" })]
      );
      return successResponse({
        ...batch,
        payments: paymentsResult.status === "SIMULATION_FAILED" ? [] : paymentsResult.returnValue,
      });
    }

    return successResponse(batch);
  } catch (err) {
    return handleApiError(err, "GET /api/batches/[id]");
  }
}));
