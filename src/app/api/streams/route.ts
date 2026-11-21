// SPDX-License-Identifier: MIT
import { nativeToScVal } from "@stellar/stellar-sdk";

import { badRequestError, handleApiError, successResponse, unauthorizedError } from "@/lib/api-response";
import { requireIdempotencyKey, withIdempotency } from "@/lib/api-route";
import { getAuthContext } from "@/lib/auth-session";
import { CHAIN_READ_SOURCE,DEFAULT_CONTRACT_ID, simulateContractCall } from "@/lib/contracts";
import { verifyCsrf } from "@/lib/csrf";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/streams — list streams or fetch single by ?id=N
 * Reads from OphirPayContract on-chain.
 */
export const GET = withMetrics("GET /api/streams", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const { searchParams } = new URL(request.url);
    const streamId = searchParams.get("id");

    if (streamId) {
      const result = await simulateContractCall(
        DEFAULT_CONTRACT_ID,
        "get_stream",
        CHAIN_READ_SOURCE,
        [nativeToScVal(streamId, { type: "u64" })]
      );
      if (result.status === "SIMULATION_FAILED") {
        return successResponse({ available: false, error: result.error });
      }
      return successResponse(result.returnValue ?? null);
    }

    const countResult = await simulateContractCall(DEFAULT_CONTRACT_ID, "get_stream_count", CHAIN_READ_SOURCE);
    if (countResult.status === "SIMULATION_FAILED") {
      return successResponse({ count: 0, available: false });
    }
    return successResponse({ count: countResult.returnValue ?? 0 });
  } catch (err) {
    return handleApiError(err, "GET /api/streams");
  }
}));

/**
 * POST /api/streams — create stream (requires wallet signing, delegates to client)
 */
export const POST = withMetrics("POST /api/streams", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const body = await request.json().catch(() => ({}));
    const { creator, recipient, totalAmount, asset, startTime, endTime, metadata } = body;

    if (!creator || !recipient || !totalAmount) {
      return badRequestError("creator, recipient, and totalAmount are required");
    }

    // Required for the same reason as the payment route (issue #1440): the
    // returned parameters are handed to the wallet to sign, and a duplicated
    // submit would sign and broadcast the stream twice.
    const idempotency = requireIdempotencyKey(request);
    if (!idempotency.ok) return idempotency.response;

    return await withIdempotency(
      request,
      { userId: auth.userId, key: idempotency.key },
      () =>
        successResponse({
          message: "Stream creation requires wallet signing via the client-side createStream flow.",
          params: { creator, recipient, totalAmount, asset: asset ?? "native", startTime, endTime, metadata },
        }, undefined, 202)
    );
  } catch (err) {
    return handleApiError(err, "POST /api/streams");
  }
}));
