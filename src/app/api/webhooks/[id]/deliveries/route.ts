// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { webhookDeliveriesQuerySchema } from "@/lib/validation-schemas";

/**
 * GET /api/webhooks/[id]/deliveries
 *
 * Returns delivery history for a webhook (original + replay attempts).
 * Used by the dashboard to surface delivery status.
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
    const parsed = webhookDeliveriesQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );
    if (!parsed.success) {
      return badRequestError(parsed.error.issues.map((e) => e.message).join("; "));
    }

    const { limit } = parsed.data;

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { deliveredAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventId: true,
        status: true,
        responseCode: true,
        isReplay: true,
        replayBatchId: true,
        deliveredAt: true,
        event: {
          select: {
            event: true,
            timestamp: true,
          },
        },
      },
    });

    return successResponse(
      deliveries.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.event.event,
        eventTimestamp: d.event.timestamp.toISOString(),
        status: d.status,
        responseCode: d.responseCode,
        isReplay: d.isReplay,
        replayBatchId: d.replayBatchId,
        deliveredAt: d.deliveredAt.toISOString(),
      })),
      { limit, total: deliveries.length },
    );
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/deliveries");
  }
}
