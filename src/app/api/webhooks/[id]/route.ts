// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";

/**
 * GET /api/webhooks/[id]
 *
 * Returns a single webhook owned by the authenticated user (secret redacted).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return badRequestError("Webhook not found");

    const { secret, ...safe } = webhook;
    return successResponse({ ...safe, hasSecret: !!secret });
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]");
  }
}
