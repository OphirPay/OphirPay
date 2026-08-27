// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, createRefundRecordSchema } from "@/lib/validation-schemas";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withRequestLogging(async function GET(request: Request) {
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
});

// ── POST /api/refunds ─────────────────────────────────────────

/**
 * Persist a refund ledger row AFTER the on-chain request_refund succeeded.
 * The on-chain id (captured from the tx return value) is stored so the UI can
 * later target approve_refund / process_refund at the correct contract record.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const parsed = await validateBody(request, createRefundRecordSchema);
    if (!parsed.success) return parsed.response;

    const { onChainId, ...data } = parsed.data;
    const refund = await prisma.refund.create({
      data: {
        ...data,
        paymentId: String(data.paymentId),
        asset: data.asset === "native" || data.asset === "" ? "native" : data.asset,
        onChainId: onChainId ?? null,
        userId: auth.userId, // never trust a client-supplied userId
      },
    });

    return successResponse(refund, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/refunds");
  }
});
