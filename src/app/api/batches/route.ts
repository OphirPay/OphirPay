// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  createBatchSchema,
  idempotencyKeySchema,
} from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { incMetric } from "@/lib/metrics-counters";
import { withRequestLogging } from "@/lib/request-logging";

// -- GET /api/batches — List batches with pagination ----------

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20", 10))
    );
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = { userId: auth.userId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [batches, total] = await Promise.all([
      prisma.batch.findMany({
        where,
        include: { payments: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.batch.count({ where }),
    ]);

    return successResponse(batches, {
      page,
      limit,
      total,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/batches");
  }
}

// -- POST /api/batches — Create a new batch ------------------

// Resolve idempotency key from the standard header first, then body.
function resolveIdempotencyKey(
  request: Request,
  body: Record<string, unknown>
): string | null {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const bodyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  return headerKey || bodyKey || null;
}

export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const idempotencyKey = resolveIdempotencyKey(request, body);

    // The header is a primary input path, so it must satisfy the same
    // validation as the body field (length, charset hygiene).
    if (request.headers.get("idempotency-key")?.trim()) {
      const headerCheck = idempotencyKeySchema.safeParse(idempotencyKey);
      if (!headerCheck.success) {
        return validationError(headerCheck.error);
      }
    }

    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { name, description, recipients: payments } = parsed.data;
    const { userId } = auth;

    // Idempotent replay: if this user already submitted this key, return the
    // original batch instead of creating a duplicate (issue #170).
    if (idempotencyKey) {
      const existing = await prisma.batch.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey },
        },
        include: { payments: true },
      });

      if (existing) {
        return successResponse(
          existing,
          {
            deduplicated: true,
            timestamp: new Date().toISOString(),
          },
          200
        );
      }
    }

    let result;

    try {
      // Atomic: the batch and its child payments are committed together, so
      // a replay can never observe a keyed batch without its payments.
      result = await prisma.$transaction(async (tx) => {
        const batch = await tx.batch.create({
          data: {
            name,
            description,
            userId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        });

        await tx.payment.createMany({
          data: payments.map((p) => ({
            amount: p.amount,
            assetCode: p.assetCode || "XLM",
            memo: p.memo || "",
            status: "CREATED",
            userId,
            batchId: batch.id,
          })),
        });

        return tx.batch.findUnique({
          where: { id: batch.id },
          include: { payments: true },
        });
      });
    } catch (err) {
      // Race: two concurrent submissions with the same key — unique constraint
      // fires; return the winning batch rather than erroring.
      if (
        idempotencyKey &&
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        const winner = await prisma.batch.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey },
          },
          include: { payments: true },
        });

        if (winner) {
          return successResponse(
            winner,
            {
              deduplicated: true,
              timestamp: new Date().toISOString(),
            },
            200
          );
        }
      }

      throw err;
    }

    incMetric("batches_processed_total");

    return successResponse(
      result,
      { timestamp: new Date().toISOString() },
      201
    );
  } catch (err) {
    return handleApiError(err, "POST /api/batches");
  }
});
