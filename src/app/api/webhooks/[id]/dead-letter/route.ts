// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { z } from "zod";

const deadLetterQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * GET /api/webhooks/[id]/dead-letter
 *
 * Query deliveries in DEAD_LETTER state with retained payloads and failure reasons.
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
      select: { id: true, url: true },
    });
    if (!webhook) return badRequestError("Webhook not found");

    const { searchParams } = new URL(request.url);
    const parsed = deadLetterQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries()),
    );
    if (!parsed.success) {
      return badRequestError(parsed.error.issues.map((e) => e.message).join("; "));
    }

    const { limit } = parsed.data;

    const deadLetters = await prisma.webhookDelivery.findMany({
      where: {
        webhookId: webhook.id,
        status: "DEAD_LETTER",
      },
      orderBy: { deliveredAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventId: true,
        status: true,
        responseCode: true,
        latencyMs: true,
        attempts: true,
        errorMessage: true,
        isReplay: true,
        replayBatchId: true,
        deliveredAt: true,
        event: {
          select: {
            id: true,
            event: true,
            timestamp: true,
            data: true,
          },
        },
      },
    });

    return successResponse(
      deadLetters.map((d) => ({
        id: d.id,
        eventId: d.eventId,
        eventType: d.event.event,
        eventTimestamp: d.event.timestamp.toISOString(),
        payload: (() => {
          try {
            return JSON.parse(d.event.data);
          } catch {
            return d.event.data;
          }
        })(),
        status: d.status,
        responseCode: d.responseCode,
        latencyMs: d.latencyMs,
        attempts: d.attempts,
        errorMessage: d.errorMessage,
        isReplay: d.isReplay,
        replayBatchId: d.replayBatchId,
        deliveredAt: d.deliveredAt.toISOString(),
      })),
      { total: deadLetters.length, limit },
    );
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/dead-letter");
  }
}
