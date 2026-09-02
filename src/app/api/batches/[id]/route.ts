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
 * GET /api/batches/[id] — single batch lookup
 * Reads from OphirPayContract on-chain. Supports ?payments=true for included payment IDs.
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
    const batchId = parseInt(id, 10);

    if (isNaN(batchId)) {
      return notFoundError("Invalid batch ID");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_batch",
      CHAIN_READ_SOURCE,
      [nativeToScVal(batchId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Batch ${id} not found`);
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
