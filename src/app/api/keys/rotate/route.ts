// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import { rotateApiKey } from "@/app/api/keys/[id]/rotate/route";

/**
 * POST /api/keys/rotate — rotate an API key by request body { id, overlapHours }.
 */
export const POST = withMetrics(
  "POST /api/keys/rotate",
  withRequestLogging(async function POST(request: Request) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const body = (await request.json().catch(() => ({}))) as {
        id?: string;
        overlapHours?: number;
      };

      if (!body.id || typeof body.id !== "string") {
        return badRequestError("Key ID is required in request body");
      }

      const result = await rotateApiKey(body.id, auth.userId, body.overlapHours);
      if (result.error) {
        return badRequestError(result.error);
      }

      return successResponse(result.data, undefined, 201);
    } catch (err) {
      return handleApiError(err, "POST /api/keys/rotate");
    }
  })
);
