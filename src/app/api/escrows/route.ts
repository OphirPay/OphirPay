// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
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
      return successResponse({ count: 0, available: false, items: [], escrows: [] });
    }
    const count = Number(countResult.returnValue ?? 0);
    const populate = searchParams.get("populate") === "true" || searchParams.get("includeItems") === "true";
    let items: unknown[] = [];

    if (populate && count > 0) {
      const limit = Math.min(50, count);
      const start = Math.max(1, count - limit + 1);
      const promises = [];
      for (let i = count; i >= start; i--) {
        promises.push(
          simulateContractCall(DEFAULT_CONTRACT_ID, "get_escrow", CHAIN_READ_SOURCE, [
            nativeToScVal(i, { type: "u64" }),
          ])
            .then((res) => (res.status !== "SIMULATION_FAILED" && res.returnValue ? res.returnValue : null))
            .catch(() => null)
        );
      }
      const results = await Promise.all(promises);
      items = results.filter(Boolean);
    }

    return successResponse({ count, items, escrows: items });
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
}));
