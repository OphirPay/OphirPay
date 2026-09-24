// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  buildTestWebhookPayload,
  buildWebhookPreview,
} from "@/lib/webhook-test";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { validateWebhookUrlWithReason } from "@/lib/webhook-url-guard";
import { storeWebhookEvent, recordWebhookDelivery } from "@/lib/webhook-event-store";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  notFoundError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";

// ── GET /api/webhooks/[id]/test ─────────────────────────────────
//
// Returns a preview of what will be transmitted to the webhook endpoint:
// target URL validation status, outgoing headers (with signed HMAC),
// canonical payload (with empty-signature canonicalization), and byte-for-byte
// outgoing payload body.
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
    if (!webhook) return notFoundError("Webhook not found");

    const { searchParams } = new URL(request.url);
    const eventParam = searchParams.get("event") as WebhookEventType | null;
    const event = (eventParam && Object.values(WEBHOOK_EVENTS).includes(eventParam))
      ? eventParam
      : WEBHOOK_EVENTS.PAYMENT_COMPLETED;

    const preview = buildWebhookPreview(webhook.url, webhook.secret, event);

    return successResponse(preview);
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/test");
  }
}

// ── POST /api/webhooks/[id]/test ────────────────────────────────
//
// Fires a sample (clearly-marked-test) event to the webhook endpoint and
// returns the delivery result including HTTP status, latency, response body,
// and linkable delivery record ID.
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

    // SSRF URL guard validation: reject blocked target before making any request
    const guard = validateWebhookUrlWithReason(webhook.url);
    if (!guard.safe) {
      return badRequestError(guard.reason || "Destination URL is blocked by security policy.");
    }

    let event: WebhookEventType = WEBHOOK_EVENTS.PAYMENT_COMPLETED;
    try {
      const body = await request.json();
      if (body && typeof body.event === "string" && Object.values(WEBHOOK_EVENTS).includes(body.event as WebhookEventType)) {
        event = body.event as WebhookEventType;
      }
    } catch {
      // Empty or non-JSON body is valid, defaults to PAYMENT_COMPLETED
    }

    const payload = buildTestWebhookPayload(event);
    const start = Date.now();
    // Single attempt for an interactive test — we want an immediate result,
    // not the production retry/backoff behavior.
    const deliverResult = await deliverWebhook(webhook.url, webhook.secret, payload, 1);
    const durationMs = Date.now() - start;

    const isSuccess = typeof deliverResult === "boolean" ? deliverResult : Boolean(deliverResult.success);
    const statusCode = typeof deliverResult === "object" && deliverResult !== null
      ? deliverResult.statusCode
      : (isSuccess ? 200 : undefined);
    const latencyMs = typeof deliverResult === "object" && deliverResult !== null
      ? deliverResult.latencyMs
      : durationMs;
    const responseBody = typeof deliverResult === "object" && deliverResult !== null
      ? deliverResult.responseBody
      : undefined;
    const errorMessage = typeof deliverResult === "object" && deliverResult !== null
      ? deliverResult.errorMessage
      : undefined;

    // Record delivery in database so a real deliveryId is generated for the full record
    let deliveryId: string | undefined;
    try {
      const eventId = await storeWebhookEvent(
        auth.userId,
        payload.event as WebhookEventType,
        payload.data,
        payload.timestamp,
      );
      if (eventId) {
        deliveryId = await recordWebhookDelivery(
          webhook.id,
          eventId,
          isSuccess ? "SUCCESS" : "FAILED",
          {
            responseCode: statusCode,
            latencyMs,
            attempts: 1,
            errorMessage: errorMessage ?? (isSuccess ? undefined : `HTTP ${statusCode ?? "unknown"}`),
          },
        );
      }
    } catch {
      // Non-fatal if DB storage for test event fails (e.g. mock DB in tests)
    }

    return successResponse({
      delivered: isSuccess,
      status: isSuccess ? "delivered" : "failed",
      statusCode,
      latencyMs,
      durationMs: latencyMs,
      responseBody: responseBody ?? "",
      deliveryId,
      event: payload.event,
      test: true,
      sentAt: payload.timestamp,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/test");
  }
}
