// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
  validationError,
} from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { contactSchema } from "@/lib/validation/contact";

export const GET = withMetrics(
  "GET /api/contacts",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError("Authentication required.");
      }
      return successResponse([]);
    } catch (err) {
      return handleApiError(err);
    }
  })
);

export const POST = withMetrics(
  "POST /api/contacts",
  withRequestLogging(async function POST(request: Request) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError("Authentication required.");
      }

      const body = await request.json().catch(() => null);
      if (body === null) {
        return badRequestError("Request body must be valid JSON");
      }

      const parsed = contactSchema.safeParse(body);
      if (!parsed.success) {
        return validationError(parsed.error);
      }

      const name = parsed.data.name ?? parsed.data.label;
      const address = parsed.data.address ?? parsed.data.publicKey;

      return successResponse(
        {
          name,
          label: name,
          address,
          publicKey: address,
          memo: parsed.data.memo,
        },
        undefined,
        201
      );
    } catch (err) {
      return handleApiError(err);
    }
  })
);
