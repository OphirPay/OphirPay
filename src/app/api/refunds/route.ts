// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  conflictError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, createRefundRecordSchema } from "@/lib/validation-schemas";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withMetrics("GET /api/refunds", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const analytics = searchParams.get("analytics") === "true";

    if (analytics) {
      const refunds = await prisma.refund.findMany({
        where: { userId: auth.userId },
        select: { reasonCode: true },
      });
      const buckets = [0, 1, 2, 3, 4, 5].map((code) => ({
        code,
        count: refunds.filter((r) => r.reasonCode === code).length,
      }));
      return successResponse(buckets);
    }

    const refunds = await prisma.refund.findMany({
      where: { userId: auth.userId },
      orderBy: { requestedAt: "desc" },
      take: 50,
      select: {
        id: true,
        paymentId: true,
        amount: true,
        asset: true,
        reason: true,
        reasonCode: true,
        status: true,
        requestedAt: true,
        resolvedAt: true,
        userId: true,
      },
    });

    return successResponse(refunds);
  } catch (err) {
    return handleApiError(err, "GET /api/refunds");
  }
}));

// ── POST /api/refunds ─────────────────────────────────────────

/**
 * Persist a refund ledger row AFTER a successful on-chain request_refund.
 * The on-chain id (captured from the tx return value) is stored so the
 * Approve → Process flow can target the correct contract record.
 */
export const POST = withMetrics("POST /api/refunds", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const parsed = await validateBody(request, createRefundRecordSchema);
    if (!parsed.success) return parsed.response;

    const { onChainId, ...data } = parsed.data;
    const paymentId = String(data.paymentId);

    // Idempotency guard (issue #365): at most one refund per payment.
    // The pre-check turns the common duplicate-submission case into a clear
    // 409 instead of a Prisma error.
    const existing = await prisma.refund.findFirst({
      where: { userId: auth.userId, paymentId },
      select: { id: true, status: true },
    });
    if (existing) {
      return conflictError(
        `A refund for this payment already exists (refund ${existing.id}, status ${existing.status}). Duplicate submissions are rejected.`
      );
    }

    try {
      const refund = await prisma.refund.create({
        data: {
          ...data,
          paymentId,
          asset: data.asset === "native" || data.asset === "" ? "native" : data.asset,
          onChainId: onChainId ?? null,
          userId: auth.userId, // never trust a client-supplied userId
        },
      });

      // Persisted audit trail entry so refund history is queryable via
      // GET /api/audit-log?source=db|all (issue #365).
      await prisma.auditLog.create({
        data: {
          action: "refund:create",
          actor: auth.userId,
          target: refund.id,
          details: {
            paymentId,
            reasonCode: refund.reasonCode,
            onChainId: refund.onChainId ?? null,
            amount: refund.amount.toString(),
          },
        },
      });

      return successResponse(refund, undefined, 201);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return conflictError(
          "A refund for this payment already exists. Duplicate submissions are rejected."
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err, "POST /api/refunds");
  }
}));
