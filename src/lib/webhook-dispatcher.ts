// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import { incMetric, incWebhookDeadLetterReason } from "@/lib/metrics-counters";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  recordWebhookDelivery,
  storeWebhookEvent,
} from "@/lib/webhook-event-store";
import { isSubscribedToEvent } from "@/lib/webhook-filter";

/**
 * Dispatch a webhook event to subscribed endpoints.
 *
 * @param scopedUserId When provided, only webhooks owned by this user are
 *   notified — prevents cross-user webhook leakage (user A's payment must
 *   never fire user B's webhook and leak A's data to B's endpoint).
 *   Events are persisted for replay when a user scope is present.
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  data: Record<string, unknown>,
  scopedUserId?: string,
): Promise<void> {
  if (typeof window !== "undefined") return;

  try {
    const activeWebhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        ...(scopedUserId ? { userId: scopedUserId } : {}),
      },
    });
    const webhooks = activeWebhooks.filter(
      (wh: Awaited<ReturnType<typeof prisma.webhook.findMany>>[number]) =>
        isSubscribedToEvent(wh.events, event),
    );
    if (webhooks.length === 0) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    logger.info("Dispatching webhooks", { event, count: webhooks.length });

    let storedEventId: string | null = null;
    if (scopedUserId) {
      storedEventId = await storeWebhookEvent(
        scopedUserId,
        event,
        data,
        payload.timestamp,
      );
    }

    // Fire all webhook deliveries in parallel (non-blocking). A delivery
    // that fails here has already exhausted deliverWebhook's own retry
    // budget, so it moves straight to the dead-letter state (issue #806)
    // instead of a plain FAILED row — the payload and last response are
    // retained so it can be inspected and bulk-redelivered later.
    const results = await Promise.allSettled(
      webhooks.map(async (wh) => {
        const result = await deliverWebhook(wh.url, wh.secret, payload);
        if (storedEventId) {
          if (result.success) {
            await recordWebhookDelivery(wh.id, storedEventId, "SUCCESS", {
              responseCode: result.statusCode,
              isReplay: false,
            });
          } else {
            const failureReason = result.failureReason ?? "UNKNOWN";
            incMetric("webhooks_dead_lettered_total");
            incWebhookDeadLetterReason(failureReason);
            await recordWebhookDelivery(wh.id, storedEventId, "DEAD_LETTER", {
              responseCode: result.statusCode,
              latencyMs: result.latencyMs,
              attempts: result.attempts,
              errorMessage: result.errorMessage,
              failureReason,
              isReplay: false,
              targetUrl: wh.url,
              canonicalBody: result.request.canonicalBody,
              requestBody: result.request.body,
              signature: result.request.signature,
              requestHeaders: JSON.stringify(result.request.headers),
              responseBody: result.responseBody,
              durationMs: result.durationMs,
              error: result.error ?? undefined,
              deadLetteredAt: new Date(),
            });
          }
        }
        return result.success;
      }),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value).length;
    const failed = results.length - succeeded;

    if (failed > 0) {
      logger.warn("Some webhook deliveries failed", { event, succeeded, failed });
    }
  } catch (err) {
    logger.error("Webhook dispatch error", { event, error: String(err) });
  }
}

export function dispatchWebhookEventAsync(
  event: WebhookEventType,
  data: Record<string, unknown>,
  scopedUserId?: string,
): void {
  if (typeof window !== "undefined") return;
  void dispatchWebhookEvent(event, data, scopedUserId);
}
