// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { createBatchSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { incMetric } from "@/lib/metrics-counters";
import { withRequestLogging } from "@/lib/request-logging";

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
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
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
