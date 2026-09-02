// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateBody, createHookSchema } from "@/lib/validation-schemas";
import { isSafeWebhookUrl } from "@/lib/webhook-url-guard";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withMetrics("GET /api/hooks", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get("event_type");

    const where: Record<string, unknown> = { userId: auth.userId, active: true };
    if (eventType) where.eventType = eventType;

    const hooks = await prisma.notificationHook.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        userId: true,
        eventType: true,
        webhookUrl: true,
        active: true,
        createdAt: true,
      },
    });

    return successResponse(hooks);
  } catch (err) {
    return handleApiError(err, "GET /api/hooks");
  }
}));

// ── POST /api/hooks ───────────────────────────────────────────

/**
 * Update a notification hook ledger row AFTER the matching on-chain
 * transition (unregister_hook) succeeded, so the list reflects deactivation.
 */
export const POST = withMetrics("POST /api/hooks", withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const idParsed = await validateIdParam(params);
    if (!idParsed.success) return idParsed.response;
    const { id } = idParsed;

    const bodyParsed = await validateBody(request, updateHookSchema);
    if (!bodyParsed.success) return bodyParsed.response;

    // Scoped update — only the owner can change their own hook row
    const result = await prisma.notificationHook.updateMany({
      where: { id, userId: auth.userId },
      data: { active: bodyParsed.data.active },
    });
    if (result.count === 0) return badRequestError("Hook not found");

    return successResponse({ updated: true });
  } catch (err) {
    return handleApiError(err, "PATCH /api/hooks/[id]");
  }
}));
