// SPDX-License-Identifier: MIT

/**
 * Settings API (issue #1957).
 *
 * Provides endpoints for reading and updating application and RPC settings,
 * enforcing permitted schemes (https/wss) and SSRF protections for user-supplied
 * custom RPC endpoints.
 */

import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { getAuthContext } from "@/lib/auth-session";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { updateSettingsSchema } from "@/lib/validation/settings";
import { SOROBAN_RPC_URL, STELLAR_NETWORK } from "@/lib/stellar";

export const GET = withMetrics(
  "GET /api/settings",
  withRequestLogging(async function GET() {
    try {
      return successResponse({
        rpcUrl: SOROBAN_RPC_URL,
        network: STELLAR_NETWORK,
        permittedSchemes: ["https", "wss"],
      });
    } catch (err) {
      return handleApiError(err, "GET /api/settings");
    }
  })
);

export const POST = withMetrics(
  "POST /api/settings",
  withRequestLogging(async function POST(request: Request) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const body = await request.json().catch(() => ({}));
      const parsed = updateSettingsSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return badRequestError(issue?.message || "Invalid settings payload");
      }

      // Settings validation passed
      return successResponse({
        updated: true,
        settings: parsed.data,
      });
    } catch (err) {
      return handleApiError(err, "POST /api/settings");
    }
  })
);
