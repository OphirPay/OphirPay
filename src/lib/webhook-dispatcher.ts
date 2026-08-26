// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";

/**
 * Fire-and-forget webhook dispatch for a given event type.
 * Looks up all active webhooks subscribed to the event, then delivers
 * the payload to each endpoint asynchronously (non-blocking).
 *
 * Safe to call from API routes, server actions, or client-side pages
 * (client calls are no-ops since Prisma only works server-side).
 */
/**
 * Dispatch a webhook event to subscribed endpoints.
 *
 * @param scopedUserId When provided, only webhooks owned by this user are
 *   notified — prevents cross-user webhook leakage (user A's payment must
 *   never fire user B's webhook and leak A's data to B's endpoint).
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  data: Record<string, unknown>,
  scopedUserId?: string,
): Promise<void> {
  // Guard: only run on server (Prisma needs Node runtime)
  if (typeof window !== "undefined") return;

  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: { contains: event },
        ...(scopedUserId ? { userId: scopedUserId } : {}),
      },
    });

    if (webhooks.length === 0) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    logger.info("Dispatching webhooks", { event, count: webhooks.length });

    // Fire all webhook deliveries in parallel (non-blocking)
    const results = await Promise.allSettled(
      webhooks.map((wh) => deliverWebhook(wh.url, wh.secret, payload)),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value).length;
    const failed = results.length - succeeded;

    if (failed > 0) {
      logger.warn("Some webhook deliveries failed", { event, succeeded, failed });
    }
  } catch (err) {
    // Never throw — webhook delivery is best-effort and must not break the caller
    logger.error("Webhook dispatch error", { event, error: String(err) });
  }
}

/**
 * Non-blocking version: schedules dispatch in the background.
 * Use this when you don't want webhook delivery to add latency to the response.
 */
export function dispatchWebhookEventAsync(
  event: WebhookEventType,
  data: Record<string, unknown>,
  scopedUserId?: string,
): void {
  if (typeof window !== "undefined") return;
  // Fire and forget — do not await
  void dispatchWebhookEvent(event, data, scopedUserId);
}
