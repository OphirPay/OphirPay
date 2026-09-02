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
 * Update the lifecycle status of a refund ledger row AFTER the matching
 * on-chain transition (approve_refund / process_refund) succeeded, so the
 * Request → Approve → Process flow is reflected in the list.
 */
export const POST = withMetrics("POST /api/refunds", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const idParsed = await validateIdParam(params);
    if (!idParsed.success) return idParsed.response;
    const { id } = idParsed;

    const bodyParsed = await validateBody(request, updateRefundStatusSchema);
    if (!bodyParsed.success) return bodyParsed.response;

    // Scoped update — only the owner can change their own refund row
    const result = await prisma.refund.updateMany({
      where: { id, userId: auth.userId },
      data: {
        status: bodyParsed.data.status,
        resolvedAt: new Date(),
      },
    });
    if (result.count === 0) return badRequestError("Refund not found");

    return successResponse({ updated: true });
  } catch (err) {
    return handleApiError(err, "PATCH /api/refunds/[id]");
  }
}));
