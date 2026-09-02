// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { buildTestWebhookPayload } from "@/lib/webhook-test";
import { deliverWebhook } from "@/lib/webhook-deliver";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  notFoundError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";

// ── POST /api/webhooks/[id]/test ────────────────────────────────
//
// Fires a sample (clearly-marked-test) event to the webhook endpoint and
// returns the delivery result. No real payment or DB record is created —
// this exists purely so integrators can verify their HMAC verification and
// endpoint handling without waiting for a live payment.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;

    // Scoped lookup — a user can only test their own webhook.
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return notFoundError("Webhook not found");
    if (!webhook.isActive) {
      return badRequestError("Webhook is paused. Resume it before sending a test event.");
    }

    const payload = buildTestWebhookPayload();
    const start = Date.now();
    // Single attempt for an interactive test — we want an immediate result,
    // not the production retry/backoff behavior.
    const delivered = await deliverWebhook(webhook.url, webhook.secret, payload, 1);
    const durationMs = Date.now() - start;

    return successResponse({
      delivered,
      status: delivered ? "delivered" : "failed",
      event: payload.event,
      test: true,
      durationMs,
      sentAt: payload.timestamp,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/test");
  }
}
