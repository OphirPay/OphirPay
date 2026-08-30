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

// ── POST /api/batches — Create a new batch ──────────────────

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

    const body = await request.json();

    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, description, recipients: payments } = parsed.data;
    const { userId } = auth;

    // Idempotency key (issue #170): the `Idempotency-Key` header takes
    // precedence over the optional body field. A present-but-invalid header —
    // including a whitespace-only value — is a validation error; it must never
    // silently fall back to a fresh key, which would allow duplicate batches.
    let idempotencyKey = parsed.data.idempotencyKey;
    const headerKey = request.headers.get("idempotency-key");
    if (headerKey !== null) {
      const headerCheck = idempotencyKeySchema.safeParse(headerKey);
      if (!headerCheck.success) {
        return validationError(headerCheck.error);
      }
      idempotencyKey = headerCheck.data;
    }

    // Re-submission of an already-processed batch: same user + same key means
    // no new batch. If the first attempt created the batch row but crashed
    // before inserting its child payments (a partial write), the retry resumes
    // by inserting only the missing payments.
    if (idempotencyKey) {
      const existing = await prisma.batch.findFirst({
        where: { userId, idempotencyKey },
        include: { payments: true },
      });

      if (existing) {
        if (existing.payments.length === 0) {
          await prisma.payment.createMany({
            data: paymentCreateData(payments, existing.id, userId),
          });
          const resumed = await fetchBatchWithPayments(existing.id);
          incMetric("batches_processed_total");
          return successResponse(
            resumed,
            { deduplicated: true, resumed: true, timestamp: new Date().toISOString() },
            200
          );
        }

        incMetric("batches_processed_total");
        return successResponse(
          existing,
          { deduplicated: true, timestamp: new Date().toISOString() },
          200
        );
      }
    }

    // First submission (or a retry with a brand-new key): persist the batch and
    // its child payments in one transaction so a keyed batch is never visible
    // half-created — it either has all its payments or none.
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const created = await tx.batch.create({
          data: {
            name,
            description,
            userId,
            // Server-generated when the client sends no key, so every batch
            // records an idempotency key. Deduplication only applies to
            // client-supplied keys, which retries actually re-send.
            idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
          },
        });

        await tx.payment.createMany({
          data: paymentCreateData(payments, created.id, userId),
        });

        return tx.batch.findUnique({
          where: { id: created.id },
          include: { payments: true },
        });
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err) && idempotencyKey) {
        // A concurrent request won the race with the same key — serve the
        // already-created batch instead of failing the retry.
        const winner = await prisma.batch.findFirst({
          where: { userId, idempotencyKey },
          include: { payments: true },
        });
        if (winner) {
          incMetric("batches_processed_total");
          return successResponse(
            winner,
            { deduplicated: true, timestamp: new Date().toISOString() },
            200
          );
        }
        // A unique violation on the compound (userId, idempotencyKey) with no
        // recoverable winner is a genuine data conflict — surface a 409 rather
        // than failing the whole request.
        return conflictError(
          "A batch with this idempotency key already exists but could not be recovered."
        );
      }
      throw err;
    }

    incMetric("batches_processed_total");

    return successResponse(result, { timestamp: new Date().toISOString() }, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/batches");
  }
}));
