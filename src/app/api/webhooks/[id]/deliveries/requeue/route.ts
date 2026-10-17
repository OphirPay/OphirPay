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
import { webhookDlqRequeueSchema } from "@/lib/validation-schemas";
import {
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
  if (
    auth.role &&
    auth.role.toUpperCase() !== "ADMIN" &&
    auth.role.toUpperCase() !== "OWNER"
  ) {
    return false;
  }
  return true;
}

/**
 * POST /api/webhooks/[id]/deliveries/requeue
 *
 * Requeues failed / dead-letter webhook deliveries (#1362) with session admin
 * authorization. Resets `attempts = 0` and sets `status = "PENDING"` while
 * preserving the original event timestamp and correlation ID. Supports
 * filtering by `deliveryId`, `deliveryIds`, or HTTP status code (`500`, `502`,
 * `504`, `"timeout"`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    if (
      !isSessionAdminAuthorized(
        auth as { userId: string; role?: string; isAdmin?: boolean }
      )
    ) {
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
      return badRequestError(
        "Webhook is paused — activate it before requeuing deliveries"
      );
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
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries/requeue");
  }
}
