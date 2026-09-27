// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { successResponse, unauthorizedError, notFoundError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");
    const { id, deliveryId } = await params;
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: id, webhook: { userId: auth.userId } },
    });
    if (!delivery) return notFoundError("Webhook delivery not found");
    return successResponse(delivery);
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/deliveries/[deliveryId]");
  }
}
