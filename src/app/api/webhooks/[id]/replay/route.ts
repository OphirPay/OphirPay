// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import crypto from "crypto";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import { webhookReplaySchema } from "@/lib/validation-schemas";
import {
  recordWebhookDelivery,
  selectEventsForReplay,
  toWebhookPayload,
} from "@/lib/webhook-event-store";
import { REPLAY_MAX_DAYS } from "@/lib/webhook-replay-config";

function parseSubscribedEvents(eventsJson: string): string[] {
  try {
    const parsed = JSON.parse(eventsJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/**
 * POST /api/webhooks/[id]/replay
 *
 * Re-delivers stored webhook events within a bounded date range.
 * Window is capped to the last 7 days; count is capped at 100 per request.
 * Each replay attempt is recorded as a delivery for dashboard visibility.
 */
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

    const body = await request.json().catch(() => ({}));
    const parsedBody = webhookReplaySchema.safeParse(body);
    if (!parsedBody.success) {
      return badRequestError(
        parsedBody.error.issues.map((e) => e.message).join("; "),
      );
    }

    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return badRequestError("Webhook not found");
    if (!webhook.isActive) return badRequestError("Webhook is paused — activate it before replaying events");

    const subscribedEvents = parseSubscribedEvents(webhook.events);
    if (subscribedEvents.length === 0) {
      return badRequestError("Webhook has no subscribed events");
    }

    const since = parsedBody.data.since ? new Date(parsedBody.data.since) : undefined;
    const until = parsedBody.data.until ? new Date(parsedBody.data.until) : undefined;

    if (since && Number.isNaN(since.getTime())) {
      return badRequestError("Invalid since date");
    }
    if (until && Number.isNaN(until.getTime())) {
      return badRequestError("Invalid until date");
    }

    const selection = await selectEventsForReplay({
      userId: auth.userId,
      subscribedEvents,
      since,
      until,
      limit: parsedBody.data.limit,
    });

    const replayBatchId = crypto.randomUUID();
    let succeeded = 0;
    let failed = 0;

    for (const stored of selection.events) {
      const payload = toWebhookPayload(stored);
      const result = await deliverWebhook(webhook.url, webhook.secret, payload);

      await recordWebhookDelivery(webhook.id, stored.id, result.success ? "SUCCESS" : "FAILED", {
        responseCode: result.statusCode,
        isReplay: true,
        replayBatchId,
      });

      if (result.success) succeeded++;
      else failed++;
    }

    logger.info("Webhook replay completed", {
      webhookId: webhook.id,
      replayBatchId,
      selected: selection.events.length,
      succeeded,
      failed,
    });

    return successResponse({
      replayBatchId,
      selected: selection.events.length,
      succeeded,
      failed,
      window: {
        since: selection.since.toISOString(),
        until: selection.until.toISOString(),
        maxDays: REPLAY_MAX_DAYS,
      },
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/replay");
  }
}
