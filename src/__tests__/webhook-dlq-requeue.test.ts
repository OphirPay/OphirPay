// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  webhook: {
    findFirst: vi.fn(),
  },
  webhookDelivery: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  webhookEvent: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: mockPrisma,
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import {
  requeueWebhookDelivery,
  requeueFailedDeliveries,
  processPendingWebhookDeliveries,
  deliverWebhook,
} from "@/lib/webhook-deliver";
import { GET as getDeliveries } from "@/app/api/webhooks/[id]/deliveries/route";
import { POST as requeueRoute } from "@/app/api/webhooks/[id]/deliveries/requeue/route";
import { createSessionToken } from "@/lib/auth-session";

describe("Webhook DLQ Requeue Helper", () => {
  const originalFetch = globalThis.fetch;
  const mockWebhook = {
    id: "wh_test_1",
    url: "https://example.com/webhook",
    secret: "test_secret_12345",
    isActive: true,
    userId: "usr_1",
  };

  const originalTimestamp = new Date("2026-08-14T10:00:00.000Z");
  const mockEvent = {
    id: "evt_corr_123",
    userId: "usr_1",
    event: "payment.completed",
    timestamp: originalTimestamp,
    data: JSON.stringify({ paymentId: "pay_999", amount: 150 }),
  };

  const mockDelivery = {
    id: "del_dlq_1",
    webhookId: "wh_test_1",
    eventId: "evt_corr_123",
    status: "DEAD_LETTER",
    attempts: 3,
    responseCode: 504,
    latencyMs: 1500,
    errorMessage: "HTTP 504",
    deliveredAt: new Date("2026-08-14T10:05:00.000Z"),
    webhook: mockWebhook,
    event: mockEvent,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "OK",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resets attempt count to 0 and transitions status to PENDING upon requeue", async () => {
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue(mockDelivery);
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      ...mockDelivery,
      status: "PENDING",
      attempts: 0,
    });

    const result = await requeueWebhookDelivery("del_dlq_1");

    expect(result.status).toBe("PENDING");
    expect(result.attempts).toBe(0);
    expect(result.correlationId).toBe("evt_corr_123");
    expect(result.eventTimestamp).toBe(originalTimestamp.toISOString());

    expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_dlq_1" },
      data: {
        status: "PENDING",
        attempts: 0,
        errorMessage: null,
        error: null,
      },
    });
  });

  it("requeues and delivers immediately preserving original timestamp and correlation ID", async () => {
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue(mockDelivery);
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      ...mockDelivery,
      status: "SUCCESS",
      attempts: 1,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"received":true}',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await requeueWebhookDelivery("del_dlq_1", {
      deliverImmediately: true,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.delivered).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.correlationId).toBe("evt_corr_123");
    expect(result.eventTimestamp).toBe(originalTimestamp.toISOString());

    // Verify fetch received the original event timestamp
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody.timestamp).toBe(originalTimestamp.toISOString());
    expect(parsedBody.event).toBe("payment.completed");
    expect(parsedBody.data).toEqual({ paymentId: "pay_999", amount: 150 });
  });

  it("throws when delivery record is not found", async () => {
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue(null);

    await expect(requeueWebhookDelivery("non_existent")).rejects.toThrow(
      "Webhook delivery not found: non_existent"
    );
  });

  it("filters and requeues by status code (e.g. 504)", async () => {
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([
      { id: "del_1" },
      { id: "del_2" },
    ]);
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue(mockDelivery);
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      ...mockDelivery,
      status: "PENDING",
      attempts: 0,
    });

    const results = await requeueFailedDeliveries({
      webhookId: "wh_test_1",
      statusCode: 504,
    });

    expect(results).toHaveLength(2);
    expect(mockPrisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_test_1",
          status: { in: ["DEAD_LETTER", "FAILED"] },
          responseCode: 504,
        }),
      })
    );
  });

  it("filters and requeues timeout failures", async () => {
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([{ id: "del_timeout" }]);
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue({
      ...mockDelivery,
      id: "del_timeout",
      errorMessage: "Webhook delivery timed out after 5000ms",
      responseCode: null,
    });
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      ...mockDelivery,
      id: "del_timeout",
      status: "PENDING",
      attempts: 0,
    });

    const results = await requeueFailedDeliveries({
      webhookId: "wh_test_1",
      statusCode: "timeout",
    });

    expect(results).toHaveLength(1);
    expect(mockPrisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_test_1",
          OR: expect.arrayContaining([
            { errorMessage: { contains: "timed out" } },
          ]),
        }),
      })
    );
  });

  it("DLQ retry worker processes pending webhook deliveries", async () => {
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([
      {
        ...mockDelivery,
        id: "del_pending_1",
        status: "PENDING",
        attempts: 0,
      },
    ]);
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue({
      ...mockDelivery,
      id: "del_pending_1",
      status: "PENDING",
    });
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      ...mockDelivery,
      id: "del_pending_1",
      status: "SUCCESS",
    });

    const workerResults = await processPendingWebhookDeliveries(10);
    expect(workerResults).toHaveLength(1);
    expect(workerResults[0].delivered).toBe(true);
  });
});

describe("GET /api/webhooks/[id]/deliveries DLQ queries", () => {
  const STELLAR_ADDRESS = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWAC";
  const sessionToken = createSessionToken(STELLAR_ADDRESS, "TESTNET");

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "usr_1" });
    mockPrisma.webhook.findFirst.mockResolvedValue({ id: "wh_1" });
  });

  it("returns 401 when request is unauthenticated", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/wh_1/deliveries");
    const res = await getDeliveries(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(401);
  });

  it("filters deliveries by status=DEAD_LETTER and statusCode=500", async () => {
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([
      {
        id: "del_500",
        eventId: "evt_1",
        status: "DEAD_LETTER",
        responseCode: 500,
        latencyMs: 350,
        attempts: 3,
        errorMessage: "HTTP 500",
        isReplay: false,
        replayBatchId: null,
        deliveredAt: new Date("2026-08-14T12:00:00Z"),
        event: {
          event: "payment.created",
          timestamp: new Date("2026-08-14T11:59:00Z"),
        },
      },
    ]);

    const req = new Request(
      "http://localhost:3000/api/webhooks/wh_1/deliveries?status=DEAD_LETTER&statusCode=500",
      {
        headers: { cookie: `ophirpay_session=${sessionToken}` },
      }
    );

    const res = await getDeliveries(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("del_500");
    expect(json.data[0].responseCode).toBe(500);
    expect(json.data[0].status).toBe("DEAD_LETTER");
    expect(json.data[0].attempts).toBe(3);
    expect(json.data[0].errorMessage).toBe("HTTP 500");

    expect(mockPrisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_1",
          status: "DEAD_LETTER",
          responseCode: 500,
        }),
      })
    );
  });

  it("supports dlq=true query parameter", async () => {
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([]);
    const req = new Request(
      "http://localhost:3000/api/webhooks/wh_1/deliveries?dlq=true",
      {
        headers: { cookie: `ophirpay_session=${sessionToken}` },
      }
    );

    const res = await getDeliveries(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(200);

    expect(mockPrisma.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_1",
          status: { in: ["DEAD_LETTER", "FAILED"] },
        }),
      })
    );
  });
});

describe("POST /api/webhooks/[id]/deliveries/requeue route", () => {
  const STELLAR_ADDRESS = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWAC";
  const sessionToken = createSessionToken(STELLAR_ADDRESS, "TESTNET");

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ id: "usr_1" });
    mockPrisma.webhook.findFirst.mockResolvedValue({ id: "wh_1" });
    mockPrisma.webhookDelivery.findMany.mockResolvedValue([{ id: "del_1" }]);
    mockPrisma.webhookDelivery.findUnique.mockResolvedValue({
      id: "del_1",
      webhookId: "wh_1",
      eventId: "evt_1",
      status: "DEAD_LETTER",
      attempts: 3,
      webhook: { id: "wh_1", url: "https://example.com/hook", secret: "sec" },
      event: {
        id: "evt_1",
        event: "payment.created",
        timestamp: new Date("2026-08-14T00:00:00Z"),
        data: "{}",
      },
    });
    mockPrisma.webhookDelivery.update.mockResolvedValue({
      id: "del_1",
      status: "PENDING",
      attempts: 0,
    });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request(
      "http://localhost:3000/api/webhooks/wh_1/deliveries/requeue",
      { method: "POST" }
    );
    const res = await requeueRoute(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin session with 403 NOT_ADMIN", async () => {
    const req = new Request(
      "http://localhost:3000/api/webhooks/wh_1/deliveries/requeue",
      {
        method: "POST",
        headers: {
          cookie: `ophirpay_session=${sessionToken}`,
          "x-admin-role": "false",
        },
      }
    );
    const res = await requeueRoute(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_ADMIN");
  });

  it("successfully requeues failed deliveries for admin session", async () => {
    const req = new Request(
      "http://localhost:3000/api/webhooks/wh_1/deliveries/requeue",
      {
        method: "POST",
        headers: {
          cookie: `ophirpay_session=${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          statusCode: 502,
          deliverImmediately: false,
        }),
      }
    );
    const res = await requeueRoute(req, {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requeuedCount).toBe(1);
    expect(json.data.deliveries[0].status).toBe("PENDING");
    expect(json.data.deliveries[0].attempts).toBe(0);
  });
});
