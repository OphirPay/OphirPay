// SPDX-License-Identifier: MIT
import { nativeToScVal } from "@stellar/stellar-sdk";

import { badRequestError, handleApiError, successResponse, unauthorizedError } from "@/lib/api-response";
import { requireScope } from "@/lib/api-route";
import { requireIdempotencyKey, withIdempotency } from "@/lib/api-route";
import { getAuthContext } from "@/lib/auth-session";
import { CHAIN_READ_SOURCE,DEFAULT_CONTRACT_ID, simulateContractCall } from "@/lib/contracts";
import { verifyCsrf } from "@/lib/csrf";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/escrows — list escrows or fetch single by ?id=N
 * Reads from OphirPayContract on-chain.
 */
export const GET = withMetrics("GET /api/escrows", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { searchParams } = new URL(request.url);
    const escrowId = searchParams.get("id");

    if (escrowId) {
      const result = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_escrow",
        CHAIN_READ_SOURCE,
        [nativeToScVal(escrowId, { type: "u64" })]
      );
      if (result.status === "SIMULATION_FAILED") {
        return successResponse({ available: false, error: result.error });
      }
      return successResponse(result.returnValue ?? null);
    }

    const countResult = await simulateContractCall(DEFAULT_CONTRACT_ID, "get_escrow_count", CHAIN_READ_SOURCE);
    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse({ count: 0, available: false });
    }
    return successResponse({ count: countResult.returnValue ?? 0 });
  } catch (err) {
    return handleApiError(err, "GET /api/escrows");
  }
}));

/**
 * POST /api/escrows — create escrow (requires wallet signing, delegates to client)
 */
export const POST = withMetrics("POST /api/escrows", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    // Creating escrow parameters is a state-changing delegated action.
    const scopeError = await requireScope(request, "escrow:write", auth);
    if (scopeError) return scopeError;

    const body = await request.json().catch(() => ({}));
    const { depositor, beneficiary, amount, asset, deadline, metadata } = body;

    if (!depositor || !beneficiary || !amount) {
      return badRequestError("depositor, beneficiary, and amount are required");
    }

    // Required for the same reason as the payment route (issue #1440): the
    // returned parameters are handed to the wallet to sign, and a duplicated
    // submit would sign and broadcast the escrow twice.
    const idempotency = requireIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;

    return await withIdempotency(
      request,
      { userId: auth.userId, key: idempotency.key },
      () =>
        successResponse({
          message: "Escrow creation requires wallet signing via the client-side createEscrow flow.",
          params: { depositor, beneficiary, amount, asset: asset ?? "native", deadline, metadata },
        }, undefined, 202)
    );
  } catch (err) {
    return handleApiError(err, "POST /api/escrows");
  }
}));
