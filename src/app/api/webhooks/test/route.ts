// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/app/api/webhooks/event-types";
import { z } from "zod";

const testWebhookSchema = z.object({
  id: z.string().min(1, "Webhook ID is required"),
  event: z.enum(Object.values(WEBHOOK_EVENTS) as [string, ...string[]]),
});

/**
 * Build a sample webhook payload for the requested event type.
 * The payload is clearly marked with `test: true` so receivers can
 * distinguish it from real payment events.
 */
function buildSamplePayload(event: WebhookEventType): {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
} {
  const timestamp = new Date().toISOString();
  const base = {
    test: true,
    event,
    timestamp,
    paymentId: "test_payment_001",
    txHash: "test_tx_hash_001",
  };

  if (event.startsWith("payment.")) {
    return {
      event,
      timestamp,
      data: {
        ...base,
        payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        payee: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3Q5M",
        amount: "10000000",
        asset: "XLM",
        status: event === WEBHOOK_EVENTS.PAYMENT_FAILED ? "FAILED" : "COMPLETED",
      },
    };
  }

  if (event.startsWith("batch.")) {
    return {
      event,
      timestamp,
      data: {
        ...base,
        batchId: "test_batch_001",
        totalAmount: "50000000",
        recipientCount: 3,
        status: event === WEBHOOK_EVENTS.BATCH_FAILED ? "FAILED" : "COMPLETED",
      },
    };
  }

  if (event.startsWith("recurrence.")) {
    return {
      event,
      timestamp,
      data: {
        ...base,
        scheduleId: "test_schedule_001",
        recurrenceId: "test_recurrence_001",
        status: event === WEBHOOK_EVENTS.RECURRENCE_FAILED ? "FAILED" : "COMPLETED",
      },
    };
  }

  if (event.startsWith("request.")) {
    return {
      event,
      timestamp,
      data: {
        ...base,
        requestId: "test_request_001",
        amount: "2500000",
        currency: "XLM",
        status: event === WEBHOOK_EVENTS.REQUEST_EXPIRED ? "EXPIRED" : "PENDING",
      },
    };
  }

  return {
    event,
    timestamp,
    data: base,
  };
}

// ── POST /api/webhooks/test ───────────────────────────────────

export const POST = withMetrics(
  "POST /api/webhooks/test",
  withRequestLogging(async function POST(request: Request) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const auth = await getAuthContext(request);
      if (!auth) return unauthorizedError("Authentication required.");

      const body = await request.json();
      const parsed = testWebhookSchema.safeParse(body);
      if (!parsed.success) {
        return badRequestError("Invalid test webhook data");
      }

      const webhook = await prisma.webhook.findFirst({
        where: { id: parsed.data.id, userId: auth.userId },
      });
      if (!webhook) return badRequestError("Webhook not found");
      if (!webhook.isActive) return badRequestError("Webhook is inactive");

      const events = JSON.parse(webhook.events) as WebhookEventType[];
      if (!events.includes(parsed.data.event)) {
        return badRequestError("Webhook is not subscribed to this event type");
      }

      const payload = buildSamplePayload(parsed.data.event);
      const delivered = await deliverWebhook(webhook.url, webhook.secret, payload, 1);

      logger.info("Webhook test delivery", {
        id: webhook.id,
        url: webhook.url,
        event: parsed.data.event,
        delivered,
      });

      return successResponse({
        delivered,
        event: parsed.data.event,
        timestamp: payload.timestamp,
        message: delivered
          ? "Test event delivered successfully"
          : "Test event delivery failed — check your endpoint and try again",
      });
    } catch (err) {
      return handleApiError(err, "POST /api/webhooks/test");
    }
  })
);
