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
import crypto from "crypto";

/**
 * POST /api/webhooks/[id]/dead-letter/redeliver
 *
 * Bulk redelivers events that exhausted retries and landed in the dead-letter queue.
 * Every bulk redelivery operation is recorded in the AuditLog.
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

    let deliveryIds: string[] | undefined;
    try {
      const body = await request.json();
      if (body && Array.isArray(body.deliveryIds)) {
        deliveryIds = body.deliveryIds;
      }
    } catch {
      // Body is optional; when empty or invalid, redeliver all dead-letter deliveries
    }

    const deadLetters = await prisma.webhookDelivery.findMany({
      where: {
        webhookId: webhook.id,
        status: "DEAD_LETTER",
        ...(deliveryIds && deliveryIds.length > 0 ? { id: { in: deliveryIds } } : {}),
      },
      include: {
        event: {
          select: { id: true, event: true, timestamp: true, data: true },
        },
      },
      take: 50, // Bound bulk redelivery batch size
    });

    if (deadLetters.length === 0) {
      return successResponse({
        message: "No dead-letter deliveries to redeliver",
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      });
    }

    const replayBatchId = `dlq_batch_${crypto.randomBytes(8).toString("hex")}`;
    const results: Array<{
      priorDeliveryId: string;
      newDeliveryId: string;
      success: boolean;
      statusCode?: number;
      errorMessage?: string;
    }> = [];

    for (const dl of deadLetters) {
      const payload = toWebhookPayload(dl.event);
      const deliveryResult = await deliverWebhook(webhook.url, webhook.secret, payload);
      const newDeliveryId = await persistDeliveryResult(webhook.id, dl.eventId, deliveryResult, {
        isReplay: true,
        replayBatchId,
      });

      results.push({
        priorDeliveryId: dl.id,
        newDeliveryId,
        success: deliveryResult.success,
        statusCode: deliveryResult.statusCode,
        errorMessage: deliveryResult.errorMessage,
      });
    }

    const succeededCount = results.filter((r) => r.success).length;
    const failedCount = results.length - succeededCount;

    // Audit the bulk redelivery operation
    await prisma.auditLog.create({
      data: {
        action: "webhook:dead-letter:bulk-redeliver",
        actor: auth.userId,
        target: webhook.id,
        details: {
          replayBatchId,
          total: deadLetters.length,
          succeeded: succeededCount,
          failed: failedCount,
          priorDeliveryIds: deadLetters.map((d) => d.id),
        },
      },
    });

    logger.info("Bulk dead-letter redelivery completed", {
      webhookId: webhook.id,
      replayBatchId,
      total: deadLetters.length,
      succeeded: succeededCount,
      failed: failedCount,
    });

    return successResponse({
      replayBatchId,
      total: deadLetters.length,
      succeeded: succeededCount,
      failed: failedCount,
      results,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/dead-letter/redeliver");
  }
}
