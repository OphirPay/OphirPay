// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import { successResponse, handleApiError, notFoundError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";
import { logger } from "@/lib/logger";

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
}

/**
 * POST /api/batches/[id] — retry failed items in a batch.
 * Resets all failed/cancelled payments back to CREATED so they can be
 * re-submitted. Returns the updated batch with progress.
 */
export async function POST(
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

/**
 * POST /api/batches/[id] — bulk-cancel the batch's PENDING payments (Issue #158).
 *
 * A failed batch can leave many pending rows to clean up; this cancels them all
 * in one request. Only payments still in PENDING are flipped to CANCELLED —
 * already-submitted (non-PENDING) payments are left untouched and reported so
 * callers know exactly what changed:
 *
 *   { batchId, cancelled, skipped, total }
 *
 * The whole check-and-update runs inside a transaction, scoped to the owning
 * user, so no other user can cancel into someone else's batch and the counts
 * are computed from the same snapshot that was updated.
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

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({
        where: { id, userId: auth.userId },
        include: { payments: true },
      });
      if (!batch) return null;

      const pending = batch.payments.filter((p) => p.status === "PENDING");

      let cancelled = 0;
      if (pending.length > 0) {
        const updated = await tx.payment.updateMany({
          where: { batchId: batch.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        cancelled = updated.count;
      }

      return {
        batchId: batch.id,
        cancelled,
        skipped: batch.payments.length - pending.length,
        total: batch.payments.length,
      };
    });

    if (!result) return notFoundError("Batch");

    logger.info("Bulk-cancelled pending batch payments", result);
    return successResponse(result);
  } catch (err) {
    return handleApiError(err, "POST /api/batches/[id]");
  }
}));
