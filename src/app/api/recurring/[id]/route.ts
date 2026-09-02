// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, notFoundError, unauthorizedError, badRequestError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, invokeContractFunction, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/recurring/[id] — single recurring payment lookup
 * Reads from OphirPayContract on-chain.
 */
export const GET = withMetrics("GET /api/recurring/[id]", withRequestLogging(async function GET(
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
    const recurringId = parseInt(id, 10);

    if (isNaN(recurringId)) {
      return notFoundError("Invalid recurring payment ID");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_recurring",
      CHAIN_READ_SOURCE,
      [nativeToScVal(recurringId, { type: "u64" })]
    );

    if (result.status === "SIMULATION_FAILED" || !result.returnValue) {
      return notFoundError(`Recurring payment ${id} not found`);
    }

    return successResponse(result.returnValue);
  } catch (err) {
    return handleApiError(err, "GET /api/recurring/[id]");
  }
}));

/**
 * PATCH /api/recurring/[id] — cancel (soft-deactivate) a recurring payment.
 * The schedule is scoped to the authenticated owner; this mirrors the
 * "cancel" action on the recurring payments list. Deactivating stops the
 * scheduler from firing it while preserving its run history.
 */
export const PATCH = withMetrics("PATCH /api/recurring/[id]", withRequestLogging(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;
    if (!id) return notFoundError("Invalid recurring payment ID");

    const result = await prisma.recurrence.updateMany({
      where: { id, userId: auth.userId },
      data: { isActive: false },
    });
    if (result.count === 0) return badRequestError("Recurring payment not found");

    if (!auth.publicKey) {
      return unauthorizedError(
        "Wallet authentication required to update recurring payments."
      );
    }

    const body = await request.json();
    if (typeof body.paused !== "boolean") {
      return badRequestError("Request body must include a 'paused' boolean field.");
    }

    // Prepare the unsigned contract invocation for the client wallet to
    // sign and submit (see submitContractInvocation). There is no
    // server-side result value to return.
    const result = await invokeContractFunction(
      DEFAULT_CONTRACT_ID,
      "set_recurring_paused",
      auth.publicKey,
      [nativeToScVal(recurringId, { type: "u64" }),
        nativeToScVal(body.paused, { type: "bool" })]
    );

    return successResponse(result);
  } catch (err) {
    return handleApiError(err, "PATCH /api/recurring/[id]");
  }
}));
