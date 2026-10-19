// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const updateMock = vi.fn();
const updateManyMock = vi.fn();
const authMock = vi.fn();
const csrfMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    webhookDelivery: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: (...args: unknown[]) => csrfMock(...args),
}));

import {
  requeueWebhookDelivery,
  bulkRequeueDlqDeliveries,
} from "@/lib/webhook-deliver";
import { POST as requeuePostRoute } from "@/app/api/webhooks/[id]/deliveries/requeue/route";
import { GET as deliveriesGetRoute } from "@/app/api/webhooks/[id]/deliveries/route";

describe("Webhook DLQ retry & requeue mechanism (#1362)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-123" });
    csrfMock.mockReturnValue(null);
  });

  describe("requeueWebhookDelivery", () => {
    it("resets attempts to 0 and marks status as PENDING by default", async () => {
      updateMock.mockResolvedValue({
        id: "del-001",
        status: "PENDING",
        attempts: 0,
        eventId: "evt-001",
        webhookId: "wh-001",
      });

      const res = await requeueWebhookDelivery("del-001");

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "del-001" },
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

      expect(res.status).toBe("PENDING");
      expect(res.attempts).toBe(0);
    });

    it("respects custom options for status and attempts retention", async () => {
      updateMock.mockResolvedValue({
        id: "del-002",
        status: "DEAD_LETTER",
        attempts: 5,
        eventId: "evt-002",
        webhookId: "wh-001",
      });

      await requeueWebhookDelivery("del-002", {
        resetAttempts: false,
        targetStatus: "DEAD_LETTER",
      });

      expect(updateMock).toHaveBeenCalledWith({
        where: { id: "del-002" },
        data: {
          status: "DEAD_LETTER",
          attempts: undefined,
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
    });
  });

  describe("bulkRequeueDlqDeliveries", () => {
    it("filters dead-lettered entries and resets them to PENDING in bulk", async () => {
      findManyMock.mockResolvedValue([
        { id: "del-101", eventId: "evt-101" },
        { id: "del-102", eventId: "evt-102" },
      ]);
      updateManyMock.mockResolvedValue({ count: 2 });

      const result = await bulkRequeueDlqDeliveries("wh-001", {
        statusCodes: [500, 502],
        onlyTimeouts: true,
        limit: 25,
      });

      expect(findManyMock).toHaveBeenCalledWith({
        where: {
          webhookId: "wh-001",
          status: {
            in: ["FAILED", "DEAD_LETTER"],
          },
          responseCode: { in: [500, 502] },
          OR: [
            { errorMessage: { contains: "timeout", mode: "insensitive" } },
            { errorMessage: { contains: "timed out", mode: "insensitive" } },
            { error: { contains: "timeout", mode: "insensitive" } },
            { error: { contains: "timed out", mode: "insensitive" } },
          ],
        },
        orderBy: { deliveredAt: "desc" },
        take: 25,
        select: { id: true, eventId: true },
      });

      expect(updateManyMock).toHaveBeenCalledWith({
        where: { id: { in: ["del-101", "del-102"] } },
        data: {
          status: "PENDING",
          attempts: 0,
          errorMessage: null,
          error: null,
        },
      });

      expect(result.requeuedCount).toBe(2);
      expect(result.deliveries).toEqual([
        { id: "del-101", eventId: "evt-101", status: "PENDING", attempts: 0 },
        { id: "del-102", eventId: "evt-102", status: "PENDING", attempts: 0 },
      ]);
    });

    it("returns zero when no matching DLQ deliveries are found", async () => {
      findManyMock.mockResolvedValue([]);

      const result = await bulkRequeueDlqDeliveries("wh-001");

      expect(updateManyMock).not.toHaveBeenCalled();
      expect(result.requeuedCount).toBe(0);
      expect(result.deliveries).toEqual([]);
    });

    it("supports selective deliveryIds filtering", async () => {
      findManyMock.mockResolvedValue([{ id: "del-targeted", eventId: "evt-targeted" }]);
      updateManyMock.mockResolvedValue({ count: 1 });

      const result = await bulkRequeueDlqDeliveries("wh-001", {
        deliveryIds: ["del-targeted"],
      });

      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["del-targeted"] },
          }),
        })
      );
      expect(result.requeuedCount).toBe(1);
    });
  });

  describe("POST /api/webhooks/[id]/deliveries/requeue route", () => {
    it("blocks request when CSRF check fails", async () => {
      const { NextResponse } = await import("next/server");
      csrfMock.mockReturnValue(NextResponse.json({ error: "CSRF invalid" }, { status: 403 }));

      const req = new Request("http://localhost/api/webhooks/wh-001/deliveries/requeue", {
        method: "POST",
      });

      const res = await requeuePostRoute(req, {
        params: Promise.resolve({ id: "wh-001" }),
      });

      expect(res.status).toBe(403);
    });

    it("blocks unauthenticated users", async () => {
      authMock.mockResolvedValue(null);

      const req = new Request("http://localhost/api/webhooks/wh-001/deliveries/requeue", {
        method: "POST",
      });

      const res = await requeuePostRoute(req, {
        params: Promise.resolve({ id: "wh-001" }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 400 if webhook is not found or owned by user", async () => {
      findFirstMock.mockResolvedValue(null);

      const req = new Request("http://localhost/api/webhooks/wh-999/deliveries/requeue", {
        method: "POST",
      });

      const res = await requeuePostRoute(req, {
        params: Promise.resolve({ id: "wh-999" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Webhook not found");
    });

    it("returns 403 if webhook is inactive", async () => {
      findFirstMock.mockResolvedValue({ id: "wh-001", isActive: false });

      const req = new Request("http://localhost/api/webhooks/wh-001/deliveries/requeue", {
        method: "POST",
      });

      const res = await requeuePostRoute(req, {
        params: Promise.resolve({ id: "wh-001" }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.message).toContain("Webhook is inactive");
    });

    it("successfully triggers bulk DLQ requeue for active webhook", async () => {
      findFirstMock.mockResolvedValue({ id: "wh-001", isActive: true });
      findManyMock.mockResolvedValue([
        { id: "del-requeued", eventId: "evt-requeued" },
      ]);
      updateManyMock.mockResolvedValue({ count: 1 });

      const req = new Request("http://localhost/api/webhooks/wh-001/deliveries/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statusCodes: [504],
          onlyTimeouts: true,
          limit: 10,
        }),
      });

      const res = await requeuePostRoute(req, {
        params: Promise.resolve({ id: "wh-001" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.webhookId).toBe("wh-001");
      expect(json.data.requeuedCount).toBe(1);
      expect(json.data.deliveries[0].status).toBe("PENDING");
      expect(json.data.deliveries[0].attempts).toBe(0);
    });
  });

  describe("GET /api/webhooks/[id]/deliveries with status filter", () => {
    it("passes status filter to prisma findMany", async () => {
      findFirstMock.mockResolvedValue({ id: "wh-001", isActive: true });
      findManyMock.mockResolvedValue([
        {
          id: "del-dlq-1",
          eventId: "evt-1",
          status: "DEAD_LETTER",
          responseCode: 504,
          isReplay: false,
          replayBatchId: null,
          deliveredAt: new Date("2026-10-17T20:00:00Z"),
          event: {
            event: "payment.failed",
            timestamp: new Date("2026-10-17T19:59:00Z"),
          },
        },
      ]);

      const req = new Request(
        "http://localhost/api/webhooks/wh-001/deliveries?status=DEAD_LETTER&limit=10",
        { method: "GET" }
      );

      const res = await deliveriesGetRoute(req, {
        params: Promise.resolve({ id: "wh-001" }),
      });

      expect(res.status).toBe(200);
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            webhookId: "wh-001",
            status: "DEAD_LETTER",
          },
          take: 10,
        })
      );
    });
  });
});
