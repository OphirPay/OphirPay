// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import {
  successResponse,
  handleApiError,
  badRequestError,
  unauthorizedError,
  jsonSafe,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";
import { checkIdempotency, saveIdempotencyRecord } from "@/lib/idempotency";

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
 * Enforces request idempotency key validation and 409 replay (issue #1302).
 */
export const POST = withMetrics("POST /api/escrows", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    // Idempotency guard (issue #1302): require Idempotency-Key header and replay 409 on duplicates
    const idempotency = await checkIdempotency(request, "escrows", auth.userId);
    if ("errorResponse" in idempotency) {
      return idempotency.errorResponse;
    }
    if (idempotency.isDuplicate) {
      return idempotency.conflictResponse;
    }
    const idempotencyKey = idempotency.key;

    const body = await request.json().catch(() => ({}));
    const { depositor, beneficiary, amount, asset, deadline, metadata } = body;

    if (!depositor || !beneficiary || !amount) {
      return badRequestError("depositor, beneficiary, and amount are required");
    }

    const payload = {
      message: "Escrow creation requires wallet signing via the client-side createEscrow flow.",
      params: { depositor, beneficiary, amount, asset: asset ?? "native", deadline, metadata },
    };

    const res = successResponse(payload, undefined, 202);

    const cachedBody = {
      success: true,
      data: jsonSafe(payload),
      meta: { timestamp: new Date().toISOString() },
    };
    await saveIdempotencyRecord(idempotencyKey, "escrows", cachedBody, 202, auth.userId);

    return res;
  } catch (err) {
    return handleApiError(err, "POST /api/escrows");
  }
}));
