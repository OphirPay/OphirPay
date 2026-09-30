// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const { paymentRequest, dispatchWebhookEventAsync, sendEmail, getHorizonServer } =
  vi.hoisted(() => ({
    paymentRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    dispatchWebhookEventAsync: vi.fn(),
    sendEmail: vi.fn(),
    getHorizonServer: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({ default: { paymentRequest } }));
vi.mock("@/lib/webhook-dispatcher", () => ({ dispatchWebhookEventAsync }));
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/stellar", () => ({ getHorizonServer }));

import {
  expireDuePaymentRequests,
  markPaymentRequestPaid,
  transactionPaysRequest,
} from "@/lib/payment-request-lifecycle";

const pendingRequest = {
  id: "request-1",
  userId: "user-1",
  amount: { toString: () => "10.5" },
  assetCode: "XLM",
  assetIssuer: null,
  description: "Invoice 42",
  recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  recipientEmail: "payer@example.com",
  notificationEmail: null,
  dueDate: new Date("2026-09-01T00:00:00.000Z"),
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  status: "PENDING",
  user: { id: "user-1", email: "owner@example.com" },
};

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue(true);
});

describe("payment request lifecycle", () => {
  it("expires due requests once and notifies the requester", async () => {
    paymentRequest.findMany.mockResolvedValue([pendingRequest]);
    paymentRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      expireDuePaymentRequests(new Date("2026-09-29T10:00:00.000Z")),
    ).resolves.toBe(1);

    expect(paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: pendingRequest.id, status: "PENDING" }),
        data: { status: "EXPIRED" },
      }),
    );
    expect(dispatchWebhookEventAsync).toHaveBeenCalledWith(
      "request.expired",
      expect.objectContaining({ requestId: pendingRequest.id, status: "EXPIRED" }),
      pendingRequest.userId,
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: expect.stringContaining("expired"),
      }),
    );
  });

  it("does not notify if another concurrent expiry sweep won the update", async () => {
    paymentRequest.findMany.mockResolvedValue([pendingRequest]);
    paymentRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(expireDuePaymentRequests()).resolves.toBe(0);
    expect(dispatchWebhookEventAsync).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("accepts only a transaction operation matching request recipient, amount, and asset", async () => {
    const call = vi.fn().mockResolvedValue({
      records: [
        {
          type: "payment",
          destination: pendingRequest.recipientAddress,
          amount: "10.5000000",
          asset_type: "native",
          created_at: "2026-08-05T00:00:00.000Z",
        },
      ],
    });
    getHorizonServer.mockReturnValue({
      operations: () => ({ forTransaction: () => ({ call }) }),
    });

    await expect(
      transactionPaysRequest(pendingRequest, "a".repeat(64)),
    ).resolves.toBe(true);
    await expect(
      transactionPaysRequest(
        { ...pendingRequest, amount: { toString: () => "11" } },
        "a".repeat(64),
      ),
    ).resolves.toBe(false);
  });

  it("sets the paid status atomically and sends the paid notification", async () => {
    paymentRequest.findUnique.mockResolvedValue({
      ...pendingRequest,
      dueDate: null,
    });
    paymentRequest.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      markPaymentRequestPaid(pendingRequest.id, "a".repeat(64)),
    ).resolves.toBe(true);
    expect(paymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: pendingRequest.id, status: "PENDING" },
      data: { status: "PAID", transactionHash: "a".repeat(64) },
    });
    expect(dispatchWebhookEventAsync).toHaveBeenCalledWith(
      "request.paid",
      expect.objectContaining({
        requestId: pendingRequest.id,
        transactionHash: "a".repeat(64),
        status: "PAID",
      }),
      pendingRequest.userId,
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com", subject: expect.stringContaining("received") }),
    );
  });
});
