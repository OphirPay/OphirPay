// SPDX-License-Identifier: MIT

import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { logger } from "@/lib/logger";
import { webhookBulkRedeliverSchema } from "@/lib/validation-schemas";
import {
  deliverWebhook,
  persistDeliveryResult,
  toWebhookPayload,
} from "@/lib/webhook-delivery-service";

/**
 * POST /api/webhooks/[id]/deliveries/redeliver
 *
 * Bulk redelivery for dead-lettered deliveries. Accepts up to 50 delivery
 * IDs, re-sends each stored payload, and records new delivery rows sharing
 * one replayBatchId so the whole bulk action stays auditable. Only rows in
 * DEAD_LETTERED state are eligible; anything else is reported as skipped.
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

    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return badRequestError("Webhook not found");
    if (!webhook.isActive) {
      return badRequestError("Webhook is paused — activate it before redelivering");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequestError("Request body must be valid JSON");
    }
    const parsed = webhookBulkRedeliverSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestError(parsed.error.issues.map((e) => e.message).join("; "));
    }

    const replayBatchId = crypto.randomUUID();
    const results: Array<{
      deliveryId: string;
      status: "QUEUED" | "SKIPPED";
      newDeliveryId?: string;
      detail?: string;
    }> = [];

    for (const deliveryId of parsed.data.deliveryIds) {
      const prior = await prisma.webhookDelivery.findFirst({
        where: { id: deliveryId, webhookId: webhook.id },
        include: {
          event: {
            select: { id: true, event: true, timestamp: true, data: true },
          },
        },
      });
      if (!prior) {
        results.push({ deliveryId, status: "SKIPPED", detail: "Delivery not found" });
        continue;
      }
      if (prior.status !== "DEAD_LETTERED") {
        results.push({
          deliveryId,
          status: "SKIPPED",
          detail: `Only DEAD_LETTERED deliveries can be bulk-redelivered (current: ${prior.status})`,
        });
        continue;
      }

      const payload = toWebhookPayload(prior.event);
      const result = await deliverWebhook(webhook.url, webhook.secret, payload);
      const newDeliveryId = await persistDeliveryResult(webhook.id, prior.eventId, result, {
        isReplay: true,
        replayBatchId,
      });
      results.push({
        deliveryId,
        status: "QUEUED",
        newDeliveryId,
        detail: result.success ? "SUCCESS" : (result.errorMessage ?? "FAILED"),
      });
    }

    logger.info("Webhook bulk redelivery completed", {
      webhookId: webhook.id,
      replayBatchId,
      requested: parsed.data.deliveryIds.length,
      queued: results.filter((r) => r.status === "QUEUED").length,
    });

    return successResponse({ replayBatchId, results });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries/redeliver");
  }
}
