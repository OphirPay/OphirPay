// SPDX-License-Identifier: MIT
//
// POST /api/fee-config/mutate — update fee configuration with sudo protection.
// Requires a fresh wallet signature if the session's last verification is
// older than 15 minutes (issue #1389).

import { withMetrics } from "@/lib/metrics-middleware";
import { successResponse, handleApiError, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import {
  withSudoProtection,
  isSessionFresh,
  type SessionInfo,
} from "@/lib/session-sudo";
import { withRequestLogging } from "@/lib/request-logging";

interface FeeConfigMutation {
  payment_fee_bps?: number;
  escrow_fee_bps?: number;
  stream_fee_bps?: number;
  batch_base_fee?: number;
  batch_per_item_fee?: number;
  enabled?: boolean;
}

function getSessionInfo(auth: Awaited<ReturnType<typeof getAuthContext>>): SessionInfo | null {
  if (!auth) return null;
  return {
    address: auth.address,
    lastVerification: auth.lastVerifiedAt ?? 0,
    authenticated: true,
  };
}

export const POST = withMetrics(
  "POST /api/fee-config/mutate",
  withRequestLogging(async function POST(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
      }

      const session = getSessionInfo(auth);

      if (!session) {
        return unauthorizedError("Invalid session.");
      }

      // Sudo check: require fresh verification for critical admin action
      if (!isSessionFresh(session)) {
        const { createSudoChallenge } = await import("@/lib/session-sudo");
        const challenge = createSudoChallenge(session.address, "update-fee-config");
        return Response.json(
          {
            error: "Re-authentication required for this action",
            code: "SUDO_REQUIRED",
            challenge,
          },
          { status: 403 }
        );
      }

      // Parse and validate the mutation body
      const body = (await request.json()) as FeeConfigMutation;
      if (!body || typeof body !== "object") {
        return Response.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }

      // Validate fee ranges
      const bpsFields = ["payment_fee_bps", "escrow_fee_bps", "stream_fee_bps"] as const;
      for (const field of bpsFields) {
        const val = body[field];
        if (val !== undefined && (typeof val !== "number" || val < 0 || val > 10000)) {
          return Response.json(
            { error: `Invalid ${field}: must be between 0 and 10000 basis points` },
            { status: 400 }
          );
        }
      }

      // In production, this would submit the on-chain transaction
      // For now, return the validated config
      return successResponse({
        applied: true,
        config: body,
        verified_at: new Date().toISOString(),
      });
    } catch (err) {
      return handleApiError(err, "POST /api/fee-config/mutate");
    }
  })
);
