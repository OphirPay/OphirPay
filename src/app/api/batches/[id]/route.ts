import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { logger } from "@/lib/logger";
import { toBatchItemStatus, computeBatchProgress } from "@/lib/batch-progress";
import type { PaymentStatus, BatchStatus } from "@/types";

/**
 * GET /api/batches/[id] — single batch with per-item progress.
 * Reads from database. Each payment is mapped to a lightweight item
 * status (pending / sent / failed) and aggregate progress counts.
 */
export const GET = withMetrics("GET /api/batches/[id]", withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;

    const batch = await prisma.batch.findFirst({
      where: { id, userId: auth.userId },
      include: { payments: true },
    });

    if (!batch) {
      return notFoundError(`Batch ${id}`);
    }

    const items = batch.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      assetCode: p.assetCode,
      status: toBatchItemStatus(p.status),
      memo: p.memo || undefined,
      errorMessage: p.errorMessage || undefined,
    }));

    const progress = computeBatchProgress(batch.payments);

    return successResponse({
      id: batch.id,
      userId: batch.userId,
      name: batch.name,
      description: batch.description,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      items,
      progress,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/batches/[id]");
  }
}));

/**
 * POST /api/batches/[id] — retry failed items in a batch.
 * Resets all failed/cancelled payments back to CREATED so they can be
 * re-submitted. Returns the updated batch with progress.
 */
export const POST = withMetrics("POST /api/batches/[id]", withRequestLogging(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { id } = await params;

    const batch = await prisma.batch.findFirst({
      where: { id, userId: auth.userId },
      include: { payments: true },
    });

    if (!batch) {
      return notFoundError(`Batch ${id}`);
    }

    const failedStatuses: PaymentStatus[] = ["FAILED", "CANCELLED"];
    const failedPayments = batch.payments.filter((p) =>
      failedStatuses.includes(p.status as PaymentStatus)
    );

    if (failedPayments.length === 0) {
      return successResponse({
        retried: 0,
        batch: {
          id: batch.id,
          name: batch.name,
          status: batch.status,
          items: batch.payments.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            assetCode: p.assetCode,
            status: toBatchItemStatus(p.status),
            memo: p.memo || undefined,
            errorMessage: p.errorMessage || undefined,
          })),
          progress: computeBatchProgress(batch.payments),
        },
      });
    }

    await prisma.payment.updateMany({
      where: {
        batchId: id,
        status: { in: failedStatuses },
      },
      data: {
        status: "CREATED",
        errorMessage: null,
      },
    });

    // If batch was FAILED or PARTIALLY_COMPLETED, move back to PROCESSING
    if (
      batch.status === ("FAILED" as BatchStatus) ||
      batch.status === ("PARTIALLY_COMPLETED" as BatchStatus)
    ) {
      await prisma.batch.update({
        where: { id },
        data: { status: "PROCESSING" as BatchStatus },
      });
    }

    const updated = await prisma.batch.findUnique({
      where: { id },
      include: { payments: true },
    });

    const items = updated!.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      assetCode: p.assetCode,
      status: toBatchItemStatus(p.status),
      memo: p.memo || undefined,
      errorMessage: p.errorMessage || undefined,
    }));

    const progress = computeBatchProgress(updated!.payments);

    return successResponse({
      retried: failedPayments.length,
      batch: {
        id: updated!.id,
        name: updated!.name,
        status: updated!.status,
        items,
        progress,
      },
    });
  } catch (err) {
    return handleApiError(err, "POST /api/batches/[id]");
  }
}));
