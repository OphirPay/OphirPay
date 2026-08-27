// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/escrows — list escrows or fetch single by ?id=N
 * Reads from OphirPayContract on-chain.
 */
export const GET = withRequestLogging(async function GET(request: Request) {
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
});

/**
 * POST /api/escrows — create escrow (requires wallet signing, delegates to client)
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const body = await request.json().catch(() => ({}));
    const { depositor, beneficiary, amount, asset, deadline, metadata } = body;

    if (!depositor || !beneficiary || !amount) {
      return badRequestError("depositor, beneficiary, and amount are required");
    }

    return successResponse({
      message: "Escrow creation requires wallet signing via the client-side createEscrow flow.",
      params: { depositor, beneficiary, amount, asset: asset ?? "native", deadline, metadata },
    }, undefined, 202);
  } catch (err) {
    return handleApiError(err, "POST /api/escrows");
  }
});
