// SPDX-License-Identifier: MIT

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

export const GET = withRequestLogging(async function GET(request: Request) {
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
});

// ── POST /api/hooks ───────────────────────────────────────────

/**
 * Persist a notification hook row AFTER the on-chain register_hook succeeded.
 * The on-chain id (captured from the tx return value) is stored so Deactivate
 * can target unregister_hook at the correct contract record.
 */
export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const parsed = await validateBody(request, createHookSchema);
    if (!parsed.success) return parsed.response;

    // SSRF guard — reject URLs targeting internal/private networks
    if (!isSafeWebhookUrl(parsed.data.webhookUrl)) {
      return badRequestError(
        "Webhook URL must be a public http(s) endpoint — internal and private addresses are not allowed."
      );
    }

    const hook = await prisma.notificationHook.create({
      data: {
        eventType: parsed.data.eventType,
        webhookUrl: parsed.data.webhookUrl,
        onChainId: parsed.data.onChainId ?? null,
        userId: auth.userId, // never trust a client-supplied userId
      },
    });

    return successResponse(hook, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/hooks");
  }
});
