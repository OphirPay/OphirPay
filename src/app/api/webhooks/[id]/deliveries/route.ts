// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  forbiddenError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import {
  webhookDeliveriesQuerySchema,
  webhookDlqRequeueSchema,
} from "@/lib/validation-schemas";
import {
  buildDlqStatusFilter,
  parseDlqStatusCodesParam,
  requeueDeadLetterDeliveries,
  requeueWebhookDelivery,
  type DlqStatusCodeFilter,
} from "@/lib/webhook-deliver";

function isSessionAdminAuthorized(auth: {
  userId: string;
  role?: string;
  isAdmin?: boolean;
}): boolean {
  if (auth.isAdmin === false) return false;
  if (auth.role && auth.role.toUpperCase() !== "ADMIN" && auth.role.toUpperCase() !== "OWNER") {
    return false;
  }
  return true;
}

/**
 * GET /api/webhooks/[id]/deliveries
 *
 * Returns delivery history for a webhook (original + replay attempts), with
 * optional Dead-Letter Queue (DLQ) status and HTTP status code filtering (#1362).
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

    const { limit, status, statusCode, statusCodes } = parsed.data;
    const parsedStatusCodes = parseDlqStatusCodesParam(statusCodes ?? statusCode);
    const statusCodeWhere = parsedStatusCodes
      ? buildDlqStatusFilter({ statusCodes: parsedStatusCodes })
      : {};

    const where: Record<string, unknown> = {
      webhookId: webhook.id,
      ...(status ? { status } : {}),
      ...statusCodeWhere,
    };

    const deliveries = await prisma.webhookDelivery.findMany({
      where: where as never,
      orderBy: { deliveredAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventId: true,
        status: true,
        responseCode: true,
        attempts: true,
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
        correlationId: d.replayBatchId ?? d.eventId,
        status: d.status,
        responseCode: d.responseCode,
        attempts: d.attempts ?? 1,
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

/**
 * POST /api/webhooks/[id]/deliveries
 *
 * Requeues failed / dead-letter webhook deliveries (#1362), resetting
 * `attempts = 0` and setting `status = "PENDING"` while preserving the original
 * event timestamp and correlation ID. Supports filtering by `deliveryId`,
 * `deliveryIds`, or HTTP status code (`500`, `502`, `504`, `"timeout"`).
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

    if (!isSessionAdminAuthorized(auth as { userId: string; role?: string; isAdmin?: boolean })) {
      return forbiddenError(
        "Session admin authorization is required to requeue dead-letter webhook deliveries."
      );
    }

    const { id } = await params;
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, userId: true, isActive: true },
    });
    if (!webhook) return badRequestError("Webhook not found");
    if (webhook.isActive === false) {
      return badRequestError("Webhook is paused — activate it before requeuing deliveries");
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsedBody = webhookDlqRequeueSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return badRequestError(
        parsedBody.error.issues.map((e) => e.message).join("; ")
      );
    }

    const {
      deliveryId,
      deliveryIds,
      statusCode,
      statusCodes,
      includeTimeouts,
      limit,
      deliverNow,
    } = parsedBody.data;

    // Single-delivery requeue path when `deliveryId` is provided without bulk filters
    if (
      deliveryId &&
      !deliveryIds?.length &&
      statusCode === undefined &&
      !statusCodes?.length &&
      !includeTimeouts
    ) {
      try {
        const single = await requeueWebhookDelivery({
          deliveryId,
          webhookId: webhook.id,
          userId: auth.userId,
          deliverNow,
        });
        return successResponse({
          webhookId: webhook.id,
          requeuedCount: 1,
          delivery: single,
          deliveries: [single],
        });
      } catch (err) {
        return badRequestError(
          err instanceof Error ? err.message : "Failed to requeue delivery"
        );
      }
    }

    const batch = await requeueDeadLetterDeliveries({
      webhookId: webhook.id,
      userId: auth.userId,
      deliveryId,
      deliveryIds,
      statusCode: statusCode as DlqStatusCodeFilter | undefined,
      statusCodes: statusCodes as DlqStatusCodeFilter[] | undefined,
      includeTimeouts,
      limit,
      deliverNow,
    });

    return successResponse(batch);
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries");
  }
}

