// SPDX-License-Identifier: MIT

// Bulk redelivery from dead-letter state (issue #806): only DEAD_LETTERED
// rows are redispatched, everything shares one auditable replayBatchId.

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const deliverMock = vi.fn();
const createMock = vi.fn().mockResolvedValue({ id: "new-delivery" });

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: { findFirst: (...args: unknown[]) => findFirstMock(...args) },
    webhookDelivery: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/webhook-delivery-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/webhook-delivery-service")>();
  return {
    ...actual,
    deliverWebhook: (...args: unknown[]) => deliverMock(...args),
  };
});

// Import after mocks are registered.
const { POST } = await import("@/app/api/webhooks/[id]/deliveries/redeliver/route");

const webhook = { id: "wh-1", userId: "user-1", isActive: true, url: "https://x.test", secret: "s" };
const deadRow = (id: string) => ({
  id,
  webhookId: "wh-1",
  eventId: "ev-1",
  status: "DEAD_LETTERED",
  event: { id: "ev-1", event: "payment.created", timestamp: new Date(), data: "{}" },
});

function post(body: unknown) {
  return POST(new Request("http://localhost/api/webhooks/wh-1/deliveries/redeliver", {
    method: "POST",
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "wh-1" }) });
}

beforeEach(() => {
  vi.restoreAllMocks();
  findFirstMock.mockReset();
  deliverMock.mockReset();
});

describe("POST bulk redeliver", () => {
  it("redelivers only dead-lettered rows under one batch id", async () => {
    findFirstMock
      .mockResolvedValueOnce(webhook)
      .mockResolvedValueOnce(deadRow("d1"))
      .mockResolvedValueOnce({ ...deadRow("d2"), status: "FAILED" });
    deliverMock.mockResolvedValue({ success: true, attempts: 1, latencyMs: 5 });

    const res = await post({ deliveryIds: ["d1", "d2"] });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(json.data.replayBatchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.data.results).toHaveLength(2);
    expect(json.data.results[0]).toMatchObject({ deliveryId: "d1", status: "QUEUED" });
    expect(json.data.results[1]).toMatchObject({ deliveryId: "d2", status: "SKIPPED" });
  });

  it("rejects empty and oversized batches", async () => {
    findFirstMock.mockResolvedValue(webhook);

    const empty = await post({ deliveryIds: [] });
    expect(empty.status).toBe(400);

    const big = await post({ deliveryIds: Array.from({ length: 51 }, (_, i) => `d${i}`) });
    expect(big.status).toBe(400);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("rejects paused webhooks", async () => {
    findFirstMock.mockResolvedValue({ ...webhook, isActive: false });

    const res = await post({ deliveryIds: ["d1"] });
    expect(res.status).toBe(400);
    expect(deliverMock).not.toHaveBeenCalled();
  });
});
