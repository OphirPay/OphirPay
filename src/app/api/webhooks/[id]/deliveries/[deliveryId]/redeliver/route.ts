// SPDX-License-Identifier: MIT

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
import {
  deliverWebhook,
  persistDeliveryResult,
  toWebhookPayload,
} from "@/lib/webhook-delivery-service";

/**
 * POST /api/webhooks/[id]/deliveries/[deliveryId]/redeliver
 *
 * Re-sends the stored payload from the original event associated with a
 * prior delivery. Records a new delivery row for dashboard visibility.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id, deliveryId } = await params;

    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return badRequestError("Webhook not found");
    if (!webhook.isActive) {
      return badRequestError("Webhook is paused — activate it before redelivering");
    }

    const prior = await prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: webhook.id },
      include: {
        event: {
          select: { id: true, event: true, timestamp: true, data: true },
        },
      },
    });
    if (!prior) return badRequestError("Delivery not found");

    const payload = toWebhookPayload(prior.event);
    const result = await deliverWebhook(webhook.url, webhook.secret, payload);
    const newDeliveryId = await persistDeliveryResult(webhook.id, prior.eventId, result);

    logger.info("Webhook redelivered", {
      webhookId: webhook.id,
      priorDeliveryId: deliveryId,
      newDeliveryId,
      success: result.success,
    });

    return successResponse({
      deliveryId: newDeliveryId,
      priorDeliveryId: deliveryId,
      status: result.success ? "SUCCESS" : "FAILED",
      responseCode: result.statusCode,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      errorMessage: result.errorMessage,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries/[deliveryId]/redeliver");
  }
}
