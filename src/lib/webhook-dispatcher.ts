// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  recordWebhookDelivery,
  storeWebhookEvent,
} from "@/lib/webhook-event-store";

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

    // Fire all webhook deliveries in parallel (non-blocking)
    const results = await Promise.allSettled(
      webhooks.map(async (wh) => {
        const result = await deliverWebhook(wh.url, wh.secret, payload);
        if (storedEventId) {
          await recordWebhookDelivery(wh.id, storedEventId, result.success ? "SUCCESS" : "FAILED", {
            responseCode: result.statusCode,
            isReplay: false,
          });
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
