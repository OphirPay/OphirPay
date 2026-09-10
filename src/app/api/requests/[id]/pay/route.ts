// SPDX-License-Identifier: MIT
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  successResponse,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { z } from "zod";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { logger } from "@/lib/logger";

const payRequestSchema = z.object({
  txHash: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = payRequestSchema.safeParse(body);

    if (!parsed.success) return validationError(parsed.error);

    const { txHash } = parsed.data;

    const req = await prisma.paymentRequest.findUnique({
      where: { id },
    });

    if (!req) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (req.status === "PAID") {
      return NextResponse.json({ error: "Already paid" }, { status: 400 });
    }

    // Mark as paid
    const updatedReq = await prisma.paymentRequest.update({
      where: { id },
      data: {
        status: "PAID",
        transactionHash: txHash,
      },
    });

    logger.info("Payment request marked as paid", { id: req.id, txHash });

    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.REQUEST_PAID,
      {
        requestId: updatedReq.id,
        amount: updatedReq.amount,
        assetCode: updatedReq.assetCode,
        transactionHash: updatedReq.transactionHash,
        status: updatedReq.status,
      },
      updatedReq.userId
    );

    return successResponse({ success: true, request: updatedReq });
  } catch (err) {
    return handleApiError(err, "POST /api/requests/[id]/pay");
  }
}
