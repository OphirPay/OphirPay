// SPDX-License-Identifier: MIT

import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { getHorizonServer } from "@/lib/stellar";

const appUrl = () =>
  (process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app").replace(/\/$/, "");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

async function emailRequester(
  request: {
    id: string;
    amount: { toString(): string };
    assetCode: string;
    description: string | null;
    notificationEmail: string | null;
    user: { id: string; email: string | null };
  },
  kind: "paid" | "expired",
  transactionHash?: string,
): Promise<void> {
  const notificationEmail = request.notificationEmail || request.user.email;
  if (!notificationEmail) return;
  const amount = `${request.amount.toString()} ${request.assetCode}`;
  const subject =
    kind === "paid"
      ? `Payment received for ${amount}`
      : `Payment request expired: ${amount}`;
  const statusText = kind === "paid" ? "has been paid" : "has expired";
  const details = request.description
    ? `<p>${escapeHtml(request.description)}</p>`
    : "";
  const transaction = transactionHash
    ? `<p>Transaction: <a href="https://stellar.expert/explorer/public/tx/${encodeURIComponent(transactionHash)}">${escapeHtml(transactionHash)}</a></p>`
    : "";
  await sendEmail({
    to: notificationEmail,
    subject,
    html: `<p>Your payment request for <strong>${escapeHtml(amount)}</strong> ${statusText}.</p>${details}${transaction}<p><a href="${appUrl()}/requests">View payment requests</a></p>`,
    text: `Your payment request for ${amount} ${statusText}.${request.description ? ` ${request.description}` : ""}${transactionHash ? ` Transaction: ${transactionHash}` : ""} View: ${appUrl()}/requests`,
  });
}

export async function expireDuePaymentRequests(now = new Date()): Promise<number> {
  const dueRequests = await prisma.paymentRequest.findMany({
    where: { status: "PENDING", dueDate: { lte: now } },
    include: { user: { select: { id: true, email: true } } },
    orderBy: { dueDate: "asc" },
    take: 500,
  });
  let expired = 0;

  for (const request of dueRequests) {
    const updated = await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: "PENDING", dueDate: { lte: now } },
      data: { status: "EXPIRED" },
    });
    if (updated.count === 0) continue;
    expired += 1;
    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.REQUEST_EXPIRED,
      {
        requestId: request.id,
        amount: request.amount,
        assetCode: request.assetCode,
        description: request.description,
        dueDate: request.dueDate?.toISOString(),
        status: "EXPIRED",
        expiredAt: now.toISOString(),
      },
      request.userId,
    );
    try {
      await emailRequester(request, "expired");
    } catch (error) {
      logger.error("Payment request expiration email failed", {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return expired;
}

export async function markPaymentRequestPaid(
  id: string,
  transactionHash: string,
): Promise<boolean> {
  const request = await prisma.paymentRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!request || request.status !== "PENDING") return false;
  if (request.dueDate && request.dueDate.getTime() <= Date.now()) {
    await expireDuePaymentRequests();
    return false;
  }

  const updated = await prisma.paymentRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "PAID", transactionHash },
  });
  if (updated.count === 0) return false;

  dispatchWebhookEventAsync(
    WEBHOOK_EVENTS.REQUEST_PAID,
    {
      requestId: request.id,
      amount: request.amount,
      assetCode: request.assetCode,
      description: request.description,
      transactionHash,
      status: "PAID",
      paidAt: new Date().toISOString(),
    },
    request.userId,
  );
  try {
    await emailRequester(request, "paid", transactionHash);
  } catch (error) {
    logger.error("Payment request paid email failed", {
      requestId: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

export async function transactionPaysRequest(
  request: {
    amount: { toString(): string };
    assetCode: string;
    assetIssuer: string | null;
    recipientAddress: string | null;
    createdAt: Date;
  },
  transactionHash: string,
): Promise<boolean> {
  if (!request.recipientAddress) return false;
  const operations = await getHorizonServer()
    .operations()
    .forTransaction(transactionHash)
    .call();
  return operations.records.some((operation) => {
    const record = operation as unknown as {
      type?: string;
      destination?: string;
      amount?: string;
      asset_type?: string;
      asset_code?: string;
      asset_issuer?: string;
      created_at?: string;
    };
    const operationCreatedAt = record.created_at
      ? Date.parse(record.created_at)
      : Number.NaN;
    if (
      !["payment", "path_payment_strict_send", "path_payment_strict_receive"].includes(
        record.type ?? "",
      ) ||
      record.destination !== request.recipientAddress ||
      !record.amount ||
      !Number.isFinite(operationCreatedAt) ||
      operationCreatedAt < request.createdAt.getTime() ||
      Math.abs(Number(record.amount) - Number(request.amount.toString())) > 0.00000005
    ) {
      return false;
    }
    if (request.assetCode === "XLM") return record.asset_type === "native";
    return (
      record.asset_type !== "native" &&
      record.asset_code === request.assetCode &&
      record.asset_issuer === request.assetIssuer
    );
  });
}
