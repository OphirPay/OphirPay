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
import { bulkRequeueDlqDeliveries } from "@/lib/webhook-deliver";

export interface RequeueRequestBody {
  statusCodes?: number[];
  onlyTimeouts?: boolean;
  limit?: number;
  deliveryIds?: string[];
}

/**
 * POST /api/webhooks/[id]/deliveries/requeue
 *
 * Inspects, filters, and bulk-requeues dead-lettered/failed webhook deliveries (issue #1362).
 * Resets attempt count to 0 and updates status to PENDING.
 * Protected by session authorization and CSRF check.
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

    const { id } = await params;

    // Verify webhook ownership
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, isActive: true },
    });
    if (!webhook) {
      return badRequestError("Webhook not found");
    }
    if (!webhook.isActive) {
      return forbiddenError("Webhook is inactive — activate it before requeuing deliveries");
    }

    const body = (await request.json().catch(() => ({}))) as RequeueRequestBody;

    const result = await bulkRequeueDlqDeliveries(webhook.id, {
      statusCodes: Array.isArray(body.statusCodes) ? body.statusCodes : undefined,
      onlyTimeouts: Boolean(body.onlyTimeouts),
      limit: typeof body.limit === "number" ? body.limit : undefined,
      deliveryIds: Array.isArray(body.deliveryIds) ? body.deliveryIds : undefined,
    });

    return successResponse({
      webhookId: webhook.id,
      requeuedCount: result.requeuedCount,
      deliveries: result.deliveries,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries/requeue");
  }
}
