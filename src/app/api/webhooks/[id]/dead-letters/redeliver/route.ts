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
import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";
import { deliverWebhook } from "@/lib/webhook-deliver";
import {
  recordWebhookDelivery,
  resolveDeadLetteredDelivery,
  toWebhookPayload,
} from "@/lib/webhook-event-store";
import { webhookDeadLetterRedeliverSchema } from "@/lib/validation-schemas";
import { DEAD_LETTER_MAX_COUNT } from "@/lib/webhook-dead-letter-config";

/**
 * POST /api/webhooks/[id]/dead-letters/redeliver
 *
 * Bulk-redelivers dead-lettered deliveries (issue #806). Without a body,
 * redelivers every currently unresolved dead letter for the webhook, up to
 * DEAD_LETTER_MAX_COUNT; pass `{ ids }` to target specific deliveries.
 * Every redelivered dead letter that now succeeds is marked resolved, and
 * the whole batch is recorded in the audit log for accountability.
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
    const parsedBody = webhookDeadLetterRedeliverSchema.safeParse(body);
    if (!parsedBody.success) {
      return badRequestError(
        parsedBody.error.issues.map((e) => e.message).join("; "),
      );
    }

    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!webhook) return badRequestError("Webhook not found");
    if (!webhook.isActive) {
      return badRequestError("Webhook is paused — activate it before redelivering");
    }

    const deadLetters = await prisma.webhookDelivery.findMany({
      where: {
        webhookId: webhook.id,
        status: "DEAD_LETTER",
        resolvedAt: null,
        ...(parsedBody.data.ids ? { id: { in: parsedBody.data.ids } } : {}),
      },
      take: DEAD_LETTER_MAX_COUNT,
      include: {
        event: { select: { id: true, event: true, timestamp: true, data: true } },
      },
    });

    if (deadLetters.length === 0) {
      return badRequestError("No unresolved dead-lettered deliveries to redeliver");
    }

    const redeliveryBatchId = crypto.randomUUID();
    let succeeded = 0;
    let failed = 0;

    for (const deadLetter of deadLetters) {
      const payload = toWebhookPayload(deadLetter.event);
      const result = await deliverWebhook(webhook.url, webhook.secret, payload);

      await recordWebhookDelivery(
        webhook.id,
        deadLetter.eventId,
        result.success ? "SUCCESS" : "DEAD_LETTER",
        {
          responseCode: result.statusCode,
          latencyMs: result.latencyMs,
          attempts: result.attempts,
          errorMessage: result.errorMessage,
          failureReason: result.success ? undefined : result.failureReason,
          redeliveryBatchId,
          redeliveredFromId: deadLetter.id,
          ...(result.success
            ? {}
            : {
                targetUrl: webhook.url,
                canonicalBody: result.request.canonicalBody,
                requestBody: result.request.body,
                signature: result.request.signature,
                requestHeaders: JSON.stringify(result.request.headers),
                responseBody: result.responseBody,
                durationMs: result.durationMs,
                error: result.error ?? undefined,
                deadLetteredAt: new Date(),
              }),
        },
      );

      if (result.success) {
        succeeded++;
        await resolveDeadLetteredDelivery(deadLetter.id);
      } else {
        failed++;
      }
    }

    incMetric("webhooks_dead_letter_redeliveries_total", deadLetters.length);
    incMetric("webhooks_dead_letter_redeliveries_succeeded_total", succeeded);

    await prisma.auditLog.create({
      data: {
        action: "webhook:dead_letter_bulk_redeliver",
        actor: auth.userId,
        target: webhook.id,
        details: {
          redeliveryBatchId,
          attempted: deadLetters.length,
          succeeded,
          failed,
          deliveryIds: deadLetters.map((d) => d.id),
        },
      },
    });

    logger.info("Webhook dead-letter bulk redelivery completed", {
      webhookId: webhook.id,
      redeliveryBatchId,
      attempted: deadLetters.length,
      succeeded,
      failed,
    });

    return successResponse({
      redeliveryBatchId,
      attempted: deadLetters.length,
      succeeded,
      failed,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/dead-letters/redeliver");
  }
}
