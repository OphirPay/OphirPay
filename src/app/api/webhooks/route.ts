// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { createWebhookSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { isSafeWebhookUrl } from "@/lib/webhook-url-guard";
import { verifyCsrf } from "@/lib/csrf";
import crypto from "crypto";
import { withRequestLogging } from "@/lib/request-logging";

// ── GET /api/webhooks ─────────────────────────────────────────

export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const webhooks = await prisma.webhook.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
    });
    const safe = webhooks.map(({ secret, ...w }) => ({ ...w, hasSecret: !!secret }));
    return successResponse(safe);
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks");
  }
});

// ── POST /api/webhooks ────────────────────────────────────────

export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const body = await request.json();
    const parsed = createWebhookSchema.safeParse(body);
    if (!parsed.success) return badRequestError("Invalid webhook data");

    // SSRF guard — reject URLs targeting internal/private networks
    if (!isSafeWebhookUrl(parsed.data.url)) {
      return badRequestError(
        "Webhook URL must be a public http(s) endpoint — internal and private addresses are not allowed."
      );
    }

    const secret = crypto.randomBytes(32).toString("hex");

    const webhook = await prisma.webhook.create({
      data: {
        url: parsed.data.url,
        events: JSON.stringify(parsed.data.events),
        isActive: parsed.data.isActive,
        secret,
        userId: auth.userId, // never trust a client-supplied userId
      },
    });

    logger.info("Webhook created", { id: webhook.id, url: webhook.url });

    return successResponse({ ...webhook, secret }, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks");
  }
});

// ── DELETE /api/webhooks?id=... ────────────────────────────────

export const DELETE = withRequestLogging(async function DELETE(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return badRequestError("Webhook ID is required");

    // Scoped delete — a user can only remove their own webhook
    const result = await prisma.webhook.deleteMany({
      where: { id, userId: auth.userId },
    });
    if (result.count === 0) return badRequestError("Webhook not found");

    return successResponse({ deleted: true });
  } catch (err) {
    return handleApiError(err, "DELETE /api/webhooks");
  }
});
