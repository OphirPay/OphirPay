// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { formatProblemDetails, zodToProblemErrors } from "@/lib/api-errors";
import prisma from "@/lib/prisma";
import { successResponse, handleApiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { z } from "zod";

const cancelPaymentSchema = z.object({
  txHash: z.string().min(1, "Transaction hash is required"),
});

function problemResponse(title: string, status: number, detail: string, instance: string, errors?: Record<string, string[]>) {
  const problem = formatProblemDetails({ title, status, detail, instance, errors });
  return new Response(JSON.stringify(problem), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/**
 * POST /api/payments/cancel — soft-cancel a payment (Issue #47).
 */
export const POST = withMetrics("POST /api/payments/cancel", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return problemResponse("Unauthorized", 401, "Authentication required. Connect your wallet or provide an API key.", request.url);
    }

    const rawBody = await request.json();
    const parsed = cancelPaymentSchema.safeParse(rawBody);
    if (!parsed.success) {
      return problemResponse("Validation Error", 400, "Invalid cancel payload", request.url, zodToProblemErrors(parsed.error));
    }
    const { txHash } = parsed.data;

    const updated = await prisma.payment.updateMany({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      return problemResponse("Not Found", 404, "Payment not found", request.url);
    }

    const payment = await prisma.payment.findFirst({
      where: { transactionHash: txHash, userId: auth.userId, deletedAt: null },
    });
    if (!payment) {
      return problemResponse("Not Found", 404, "Payment not found", request.url);
    }

    logger.info("Payment cancelled", { id: payment.id, status: payment.status });
    return successResponse(payment);
  } catch (err) {
    return handleApiError(err, "POST /api/payments/cancel");
  }
}));