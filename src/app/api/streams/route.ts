// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";
import {
  checkIdempotencyKey,
  storeIdempotencyResponse,
  validateIdempotencyKeyHeader,
} from "@/lib/idempotency";

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

    const keyValidation = validateIdempotencyKeyHeader(
      request.headers.get("idempotency-key")
    );
    if (!keyValidation.ok) {
      return keyValidation.errorResponse;
    }
    const idempotencyKey = keyValidation.key;

    const body = await request.json().catch(() => ({}));
    const { creator, recipient, totalAmount, asset, startTime, endTime, metadata } = body;

    if (!creator || !recipient || !totalAmount) {
      return badRequestError("creator, recipient, and totalAmount are required");
    }

    let payloadHash: string | null = null;
    if (idempotencyKey) {
      const check = checkIdempotencyKey({
        scope: "POST /api/streams",
        userId: auth.userId,
        key: idempotencyKey,
        payload: { creator, recipient, totalAmount, asset: asset ?? "native", startTime, endTime, metadata },
      });
      if (check.status === "hit" || check.status === "conflict") {
        return check.response;
      }
      payloadHash = check.payloadHash;
    }

    const response = successResponse({
      message: "Stream creation requires wallet signing via the client-side createStream flow.",
      params: { creator, recipient, totalAmount, asset: asset ?? "native", startTime, endTime, metadata },
    }, undefined, 202);

    if (idempotencyKey && payloadHash) {
      return await storeIdempotencyResponse({
        scope: "POST /api/streams",
        userId: auth.userId,
        key: idempotencyKey,
        payloadHash,
        response,
      });
    }

    return response;
  } catch (err) {
    return handleApiError(err, "POST /api/streams");
  }
}));
