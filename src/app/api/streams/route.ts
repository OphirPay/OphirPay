// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
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
      return successResponse({ count: 0, available: false, items: [], streams: [] });
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
          simulateContractCall(DEFAULT_CONTRACT_ID, "get_stream", CHAIN_READ_SOURCE, [
            nativeToScVal(i, { type: "u64" }),
          ])
            .then((res) => (res.status !== "SIMULATION_FAILED" && res.returnValue ? res.returnValue : null))
            .catch(() => null)
        );
      }
      const results = await Promise.all(promises);
      items = results.filter(Boolean);
    }

    return successResponse({ count, items, streams: items });
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

    return successResponse({
      message: "Stream creation requires wallet signing via the client-side createStream flow.",
      params: { creator, recipient, totalAmount, asset: asset ?? "native", startTime, endTime, metadata },
    }, undefined, 202);
  } catch (err) {
    return handleApiError(err, "POST /api/streams");
  }
}));
