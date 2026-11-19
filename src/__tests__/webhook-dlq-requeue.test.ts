// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requeueWebhookDelivery,
  bulkRequeueDlqDeliveries,
} from "@/lib/webhook-deliver";
import { GET } from "@/app/api/webhooks/[id]/deliveries/route";
import { POST } from "@/app/api/webhooks/[id]/deliveries/requeue/route";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findFirst: vi.fn(),
    },
    webhookDelivery: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";

const mockPrismaWebhook = vi.mocked(prisma.webhook);
const mockPrismaDelivery = vi.mocked(prisma.webhookDelivery);
const mockGetAuth = vi.mocked(getAuthContext);

describe("Dead-Letter Queue (DLQ) Requeue Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requeueWebhookDelivery resets attempt count and sets status to PENDING", async () => {
    mockPrismaDelivery.update.mockResolvedValue({
      id: "del_1",
      status: "PENDING" as unknown as never,
      attempts: 0,
      eventId: "evt_1",
      webhookId: "wh_1",
    } as unknown as never);

    const result = await requeueWebhookDelivery("del_1");

    expect(mockPrismaDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        status: "PENDING",
        attempts: 0,
        errorMessage: null,
        error: null,
      },
      select: {
        id: true,
        status: true,
        attempts: true,
        eventId: true,
        webhookId: true,
      },
    });

    expect(result.status).toBe("PENDING");
    expect(result.attempts).toBe(0);
    expect(result.eventId).toBe("evt_1");
  });

  it("bulkRequeueDlqDeliveries filters by statusCodes and timeouts and updates candidates", async () => {
    mockPrismaDelivery.findMany.mockResolvedValue([
      { id: "del_10", eventId: "evt_10" },
      { id: "del_11", eventId: "evt_11" },
    ] as unknown as never);
    mockPrismaDelivery.updateMany.mockResolvedValue({ count: 2 } as unknown as never);

    const result = await bulkRequeueDlqDeliveries("wh_1", {
      statusCodes: [500, 502],
      onlyTimeouts: true,
      limit: 20,
    });

    expect(mockPrismaDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_1",
          status: { in: ["FAILED", "DEAD_LETTER"] },
          responseCode: { in: [500, 502] },
        }),
      })
    );

    expect(mockPrismaDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["del_10", "del_11"] } },
      data: {
        status: "PENDING",
        attempts: 0,
        errorMessage: null,
        error: null,
      },
    });

    expect(result.requeuedCount).toBe(2);
    expect(result.deliveries).toEqual([
      { id: "del_10", eventId: "evt_10", status: "PENDING", attempts: 0 },
      { id: "del_11", eventId: "evt_11", status: "PENDING", attempts: 0 },
    ]);
  });

  it("bulkRequeueDlqDeliveries returns empty when no candidates match", async () => {
    mockPrismaDelivery.findMany.mockResolvedValue([]);

    const result = await bulkRequeueDlqDeliveries("wh_1", { statusCodes: [504] });

    expect(mockPrismaDelivery.updateMany).not.toHaveBeenCalled();
    expect(result.requeuedCount).toBe(0);
    expect(result.deliveries).toEqual([]);
  });
});

describe("GET /api/webhooks/[id]/deliveries DLQ queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockResolvedValue({ userId: "user_1" } as unknown as never);
    mockPrismaWebhook.findFirst.mockResolvedValue({ id: "wh_1" } as unknown as never);
  });

  it("filters deliveries by status and statusCode", async () => {
    mockPrismaDelivery.findMany.mockResolvedValue([
      {
        id: "del_1",
        eventId: "evt_1",
        status: "DEAD_LETTER",
        responseCode: 504,
        isReplay: false,
        replayBatchId: null,
        deliveredAt: new Date("2026-10-18T10:00:00Z"),
        event: {
          event: "payment.created",
          timestamp: new Date("2026-10-18T09:59:00Z"),
        },
      },
    ] as unknown as never);

    const req = new Request(
      "http://localhost/api/webhooks/wh_1/deliveries?status=DEAD_LETTER&statusCode=504"
    );
    const res = await GET(req, { params: Promise.resolve({ id: "wh_1" }) });

    expect(res.status).toBe(200);
    expect(mockPrismaDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          webhookId: "wh_1",
          status: "DEAD_LETTER",
          responseCode: 504,
        },
      })
    );

    const json = await res.json();
    expect(json.data[0].status).toBe("DEAD_LETTER");
    expect(json.data[0].responseCode).toBe(504);
  });
});

describe("POST /api/webhooks/[id]/deliveries/requeue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if unauthenticated", async () => {
    mockGetAuth.mockResolvedValue(null);

    const req = new Request(
      "http://localhost/api/webhooks/wh_1/deliveries/requeue",
      { method: "POST", body: JSON.stringify({}) }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "wh_1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 if webhook is not found", async () => {
    mockGetAuth.mockResolvedValue({ userId: "user_1" } as unknown as never);
    mockPrismaWebhook.findFirst.mockResolvedValue(null);

    const req = new Request(
      "http://localhost/api/webhooks/wh_1/deliveries/requeue",
      { method: "POST", body: JSON.stringify({}) }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "wh_1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 403 if webhook is inactive", async () => {
    mockGetAuth.mockResolvedValue({ userId: "user_1" } as unknown as never);
    mockPrismaWebhook.findFirst.mockResolvedValue({
      id: "wh_1",
      isActive: false,
    } as unknown as never);

    const req = new Request(
      "http://localhost/api/webhooks/wh_1/deliveries/requeue",
      { method: "POST", body: JSON.stringify({}) }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "wh_1" }) });
    expect(res.status).toBe(403);
  });

  it("successfully requeues matching DLQ deliveries", async () => {
    mockGetAuth.mockResolvedValue({ userId: "user_1" } as unknown as never);
    mockPrismaWebhook.findFirst.mockResolvedValue({
      id: "wh_1",
      isActive: true,
    } as unknown as never);
    mockPrismaDelivery.findMany.mockResolvedValue([
      { id: "del_1", eventId: "evt_1" },
    ] as unknown as never);
    mockPrismaDelivery.updateMany.mockResolvedValue({ count: 1 } as unknown as never);

    const req = new Request(
      "http://localhost/api/webhooks/wh_1/deliveries/requeue",
      {
        method: "POST",
        body: JSON.stringify({ statusCodes: [500], onlyTimeouts: true }),
      }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "wh_1" }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.requeuedCount).toBe(1);
    expect(json.data.deliveries[0].status).toBe("PENDING");
  });
});
