// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { createPaymentRequestSchema } from "@/lib/validation-schemas";
import {
  successResponse,
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getAuthContext } from "@/lib/auth-session";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const requests = await prisma.paymentRequest.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
    });
    return successResponse(requests);
  } catch (err) {
    return handleApiError(err, "GET /api/requests");
  }
});

export const POST = withRequestLogging(async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const body = await request.json();
    const parsed = createPaymentRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const req = await prisma.paymentRequest.create({
      data: {
        amount: parsed.data.amount,
        assetCode: parsed.data.assetCode,
        assetIssuer: parsed.data.assetIssuer,
        description: parsed.data.description,
        recipientAddress: parsed.data.recipientAddress,
        userId: auth.userId,
      },
    });

    logger.info("Payment request created", { id: req.id, amount: req.amount });

    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.REQUEST_CREATED,
      {
        requestId: req.id,
        amount: req.amount,
        assetCode: req.assetCode,
        description: req.description,
        status: req.status,
        createdAt: req.createdAt.toISOString(),
      },
      auth.userId
    );

    return successResponse(req, undefined, 201);
  } catch (err) {
    return handleApiError(err, "POST /api/requests");
  }
});
