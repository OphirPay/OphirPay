// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany, mockDeliverWebhook } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockDeliverWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: { findMany: mockFindMany },
  },
}));

vi.mock("@/lib/webhook-deliver", () => ({
  deliverWebhook: mockDeliverWebhook,
}));

import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher";

beforeEach(() => {
  vi.clearAllMocks();
  mockDeliverWebhook.mockResolvedValue(true);
});

describe("dispatchWebhookEvent", () => {
  it("dispatches only to webhooks subscribed to the event type", async () => {
    mockFindMany.mockResolvedValue([
      { id: "wh-1", url: "https://a.com/hook", secret: "secret-a", events: '["payment.created"]' },
    ]);

    await dispatchWebhookEvent("payment.created", { id: "p1" });

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        events: { contains: "payment.created" },
      },
    });
    expect(mockDeliverWebhook).toHaveBeenCalledTimes(1);
    expect(mockDeliverWebhook).toHaveBeenCalledWith(
      "https://a.com/hook",
      "secret-a",
      expect.objectContaining({ event: "payment.created", data: { id: "p1" } })
    );
  });

  it("scopes deliveries to the requesting user when provided", async () => {
    mockFindMany.mockResolvedValue([]);

    await dispatchWebhookEvent("payment.created", { id: "p1" }, "user-1");

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        events: { contains: "payment.created" },
        userId: "user-1",
      },
    });
  });

  it("does not deliver to webhooks subscribed to a different event type", async () => {
    mockFindMany.mockResolvedValue([]);

    await dispatchWebhookEvent("batch.created", { id: "b1" });

    expect(mockDeliverWebhook).not.toHaveBeenCalled();
  });
});
