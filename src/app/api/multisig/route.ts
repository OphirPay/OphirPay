// SPDX-License-Identifier: MIT

import { successResponse, handleApiError, badRequestError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { simulateContractCall, DEFAULT_CONTRACT_ID, CHAIN_READ_SOURCE } from "@/lib/contracts";
import { setMultisigConfig } from "@/lib/contract-advanced";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/multisig — current multisig configuration
 * Reads from the Soroban contract via OphirPayContract.get_multisig_config().
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const result = await simulateContractCall(
      DEFAULT_CONTRACT_ID,
      "get_multisig_config",
      CHAIN_READ_SOURCE
    );

    if (result.status === "SIMULATION_FAILED") {
      return successResponse({
        threshold: 0,
        signers: [] as string[],
        enabled: false,
        source: "contract_unavailable",
      });
    }

    return successResponse(result.returnValue ?? {
      threshold: 0,
      signers: [],
      enabled: false,
    });
  } catch (err) {
    return handleApiError(err, "GET /api/multisig");
  }
});

/**
 * POST /api/multisig — configure multisig (owner-only, calls Soroban contract)
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
    }

    const body = await request.json().catch(() => ({}));
    const { caller, threshold, signers, enabled } = body;

    if (!caller) {
      return badRequestError("caller (public key) is required");
    }

    const result = await setMultisigConfig(
      caller,
      threshold ?? 2,
      signers ?? [],
      enabled ?? false
    );

    if (!result.success) {
      return badRequestError(result.error || "Contract error");
    }

    return successResponse({ txHash: result.txHash, ...body }, undefined, 200);
  } catch (err) {
    return handleApiError(err, "POST /api/multisig");
  }
});
