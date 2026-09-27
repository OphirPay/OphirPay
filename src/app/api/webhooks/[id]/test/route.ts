// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { buildTestWebhookPayload } from "@/lib/webhook-test";
import { buildWebhookRequestPreview, deliverWebhookWithDetails } from "@/lib/webhook-deliver";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  notFoundError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { validateWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";
import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";

type TestRequestBody = {
  event?: string;
  timestamp?: string;
};

function parseEvent(value: string | null | undefined): WebhookEventType {
  return value && ALL_WEBHOOK_EVENTS.includes(value as WebhookEventType)
    ? (value as WebhookEventType)
    : WEBHOOK_EVENTS.PAYMENT_COMPLETED;
}

function parseTimestamp(value: string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function getOwnedWebhook(request: Request, id: string) {
  const auth = await getAuthContext(request);
  if (!auth) return { error: unauthorizedError("Authentication required.") };

  const webhook = await prisma.webhook.findFirst({
    where: { id, userId: auth.userId },
  });
  if (!webhook) return { error: notFoundError("Webhook not found") };
  return { webhook };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const owned = await getOwnedWebhook(request, id);
    if (owned.error) return owned.error;
    if (!owned.webhook.isActive) {
      return badRequestError("Webhook is paused. Resume it before previewing a test event.");
    }

    const { searchParams } = new URL(request.url);
    const timestamp = parseTimestamp(searchParams.get("timestamp"));
    if (!timestamp) return badRequestError("Preview timestamp is invalid.");

    const validation = await validateWebhookUrlAtDelivery(owned.webhook.url);
    if (!validation.valid) {
      return badRequestError(`${validation.reason} No request was sent.`);
    }

    const payload = buildTestWebhookPayload(
      parseEvent(searchParams.get("event")),
      timestamp,
    );
    return successResponse({
      targetUrl: validation.url,
      event: payload.event,
      timestamp: payload.timestamp,
      preview: buildWebhookRequestPreview(payload, owned.webhook.secret),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/test");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const { id } = await params;
    const owned = await getOwnedWebhook(request, id);
    if (owned.error) return owned.error;
    if (!owned.webhook.isActive) {
      return badRequestError("Webhook is paused. Resume it before sending a test event.");
    }

    let requestBody: TestRequestBody = {};
    try {
      requestBody = (await request.json()) as TestRequestBody;
    } catch {
      requestBody = {};
    }
    const timestamp = parseTimestamp(requestBody.timestamp);
    if (!timestamp) return badRequestError("Test event timestamp is invalid.");

    const validation = await validateWebhookUrlAtDelivery(owned.webhook.url);
    if (!validation.valid) {
      return badRequestError(`${validation.reason} No request was sent.`);
    }

    const payload = buildTestWebhookPayload(parseEvent(requestBody.event), timestamp);
    const result = await deliverWebhookWithDetails(
      owned.webhook.url,
      owned.webhook.secret,
      payload,
      1,
    );

    if (result.blocked) {
      return badRequestError(`${result.error ?? "The URL guard rejected this target."} No request was sent.`);
    }

    const responseBodyExcerpt = result.responseBody.length > 500
      ? `${result.responseBody.slice(0, 500)}…`
      : result.responseBody;
    const storedEvent = await prisma.webhookEvent.create({
      data: {
        userId: owned.webhook.userId,
        event: payload.event,
        timestamp: new Date(payload.timestamp),
        data: JSON.stringify(payload.data),
      },
    });
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: owned.webhook.id,
        eventId: storedEvent.id,
        status: result.success ? "SUCCESS" : "FAILED",
        responseCode: result.statusCode,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        errorMessage: result.errorMessage,
        test: true,
        targetUrl: validation.url,
        canonicalBody: result.request.canonicalBody,
        requestBody: result.request.body,
        signature: result.request.signature,
        requestHeaders: JSON.stringify(result.request.headers),
        responseBody: result.responseBody,
        durationMs: result.durationMs,
        error: result.error,
      },
    });

    return successResponse({
      delivered: result.delivered,
      status: result.delivered ? "delivered" : "failed",
      event: payload.event,
      test: true,
      durationMs: result.durationMs,
      sentAt: payload.timestamp,
      responseStatus: result.status,
      responseBodyExcerpt,
      deliveryId: delivery.id,
      targetUrl: validation.url,
      preview: result.request,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/test");
  }
}
