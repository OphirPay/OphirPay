// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { assertScope } from "@/lib/api-auth";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * POST /api/escrow/release — release an existing escrow (#1312)
 */
export const POST = withMetrics("POST /api/escrow/release", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const scopeError = assertScope(auth, "escrow:release");
    if (scopeError) return scopeError;

    const body = await request.json().catch(() => ({}));
    const { escrowId } = body;

    if (!escrowId) {
      return badRequestError("escrowId is required");
    }

    return successResponse({
      message: "Escrow release requires wallet signing via the client-side releaseEscrow flow.",
      params: { escrowId },
    }, undefined, 202);
  } catch (err) {
    return handleApiError(err, "POST /api/escrow/release");
  }
}));
