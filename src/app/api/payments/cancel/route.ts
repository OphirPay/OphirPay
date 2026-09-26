// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { successResponse, notFoundError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { withMutatingRoute } from "@/lib/api-wrapper";
import { z } from "zod";

const cancelPaymentSchema = z.object({
  txHash: z.string().min(1, "Transaction hash is required"),
});

/**
 * POST /api/payments/cancel — soft-cancel a payment (Issue #47).
 *
 * Marks a payment as CANCELLED so the UI can display the status change
 * optimistically while the server confirms.
 */
export const POST = withMutatingRoute(
  {
    route: "POST /api/payments/cancel",
    bodySchema: cancelPaymentSchema,
  },
  async ({ body, auth }) => {
    const { txHash } = body;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) return notFoundError("Payment");

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) return notFoundError("Payment");

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  }
);
