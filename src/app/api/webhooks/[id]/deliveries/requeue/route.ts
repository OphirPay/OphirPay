// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  badRequestError,
  unauthorizedError,
  errorResponse,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext, isSessionAdmin } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { ERROR_CODES } from "@/lib/error-codes";
import { requeueFailedDeliveries } from "@/lib/webhook-deliver";
import { requeueWebhookDeliveriesSchema } from "@/lib/validation-schemas";

/**
 * POST /api/webhooks/[id]/deliveries/requeue
 *
 * Administrative endpoint to selectively filter and requeue dead-lettered /
 * failed webhook deliveries. Resets attempt count to 0 and marks deliveries
 * PENDING (or executes immediately if deliverImmediately=true).
 *
 * Protected by session admin permissions.
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

    if (!isSessionAdmin(auth)) {
      return errorResponse(
        ERROR_CODES.NOT_ADMIN,
        "Admin permissions required.",
        403,
      );
    }

    const { id } = await params;
    const webhook = await prisma.webhook.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true },
    });
    if (!webhook) return badRequestError("Webhook not found");

    let rawBody: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text.trim()) {
        rawBody = JSON.parse(text);
      }
    } catch {
      return badRequestError("Invalid JSON body");
    }

    const parsed = requeueWebhookDeliveriesSchema.safeParse(rawBody);
    if (!parsed.success) {
      return badRequestError(parsed.error.issues.map((e) => e.message).join("; "));
    }

    const results = await requeueFailedDeliveries({
      webhookId: webhook.id,
      deliveryIds: parsed.data.deliveryIds,
      statusCode: parsed.data.statusCode,
      statusCodes: parsed.data.statusCodes,
      timeoutOnly: parsed.data.timeoutOnly,
      deliverImmediately: parsed.data.deliverImmediately,
      limit: parsed.data.limit,
    });

    return successResponse({
      requeuedCount: results.length,
      deliveries: results,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/deliveries/requeue");
  }
}
