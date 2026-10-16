// SPDX-License-Identifier: MIT
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { retryPaymentSchema } from "@/lib/validation-schemas";
import { formatProblemDetails, zodToProblemErrors } from "@/lib/api-errors";
import { successResponse, handleApiError } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";

function problemResponse(title: string, status: number, detail: string, instance: string, errors?: Record<string, string[]>) {
  const problem = formatProblemDetails({ title, status, detail, instance, errors });
  return new Response(JSON.stringify(problem), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/**
 * POST /api/payments/retry
 */
export async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return problemResponse("Unauthorized", 401, "Authentication required. Connect your wallet or provide an API key.", request.url);
    }

    const body = await request.json().catch(() => null);
    const parsed = retryPaymentSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return problemResponse("Validation Error", 400, "Invalid retry payload", request.url, zodToProblemErrors(parsed.error));
    }

    const { id } = parsed.data;

    const payment = await prisma.payment.findFirst({
      where: { id, userId: auth.userId, deletedAt: null },
    });
    if (!payment) {
      return problemResponse("Not Found", 404, "Payment not found", request.url);
    }

    if (payment.status !== "FAILED") {
      return problemResponse("Conflict", 409, `Only failed payments can be retried (current status: ${payment.status})`, request.url);
    }

    const updated = await prisma.payment.updateMany({
      where: { id, userId: auth.userId },
      data: {
        status: "PENDING",
        errorMessage: null,
        transactionHash: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    if (updated.count === 0) {
      return problemResponse("Not Found", 404, "Payment not found", request.url);
    }

    const retried = await prisma.payment.findUnique({ where: { id } });
    if (!retried) {
      return problemResponse("Not Found", 404, "Payment not found", request.url);
    }

    logger.info("Payment retried", {
      id,
      previousStatus: payment.status,
      newStatus: retried.status,
    });

    return successResponse(retried);
  } catch (err) {
    return handleApiError(err, "POST /api/payments/retry");
  }
}