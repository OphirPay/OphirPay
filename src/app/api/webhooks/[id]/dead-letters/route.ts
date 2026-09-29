// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { webhookDeadLettersQuerySchema } from "@/lib/validation-schemas";
import { DEAD_LETTER_DEFAULT_COUNT } from "@/lib/webhook-dead-letter-config";

/**
 * GET /api/webhooks/[id]/dead-letters
 *
 * Lists deliveries that exhausted their retry budget (issue #806). By
 * default only unresolved dead letters are returned; pass
 * `includeResolved=true` to also see ones already cleared by a redelivery.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true },
    });
    if (!webhook) return badRequestError("Webhook not found");

    const { searchParams } = new URL(request.url);
    const parsed = webhookDeadLettersQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );
    if (!parsed.success) {
      return badRequestError(parsed.error.issues.map((e) => e.message).join("; "));
    }

    const limit = parsed.data.limit ?? DEAD_LETTER_DEFAULT_COUNT;

    const deadLetters = await prisma.webhookDelivery.findMany({
      where: {
        webhookId: webhook.id,
        status: "DEAD_LETTER",
        ...(parsed.data.includeResolved ? {} : { resolvedAt: null }),
      },
      orderBy: { deadLetteredAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventId: true,
        attempts: true,
        responseCode: true,
        failureReason: true,
        errorMessage: true,
        responseBody: true,
        targetUrl: true,
        deadLetteredAt: true,
        resolvedAt: true,
        redeliveryBatchId: true,
        deliveredAt: true,
        event: {
          select: { event: true, timestamp: true },
        },
      },
    });

    return successResponse(
      deadLetters.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.event.event,
        eventTimestamp: d.event.timestamp.toISOString(),
        attempts: d.attempts,
        responseCode: d.responseCode,
        failureReason: d.failureReason,
        errorMessage: d.errorMessage,
        responseBodyExcerpt:
          d.responseBody && d.responseBody.length > 500
            ? `${d.responseBody.slice(0, 500)}…`
            : d.responseBody,
        targetUrl: d.targetUrl,
        deadLetteredAt: d.deadLetteredAt?.toISOString() ?? null,
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        redeliveryBatchId: d.redeliveryBatchId,
        deliveredAt: d.deliveredAt.toISOString(),
      })),
      { limit, total: deadLetters.length },
    );
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/dead-letters");
  }
}
