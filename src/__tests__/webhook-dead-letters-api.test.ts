// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Coverage for the dead-letter queue routes added for issue #806:
 *   GET  /api/webhooks/[id]/dead-letters
 *   POST /api/webhooks/[id]/dead-letters/redeliver
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCsrfToken } from "@/lib/csrf";

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: {
      findFirst: vi.fn(),
    },
    webhookDelivery: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/webhook-deliver", () => ({
  deliverWebhook: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { GET } from "@/app/api/webhooks/[id]/dead-letters/route";
import { POST } from "@/app/api/webhooks/[id]/dead-letters/redeliver/route";

const authMock = vi.mocked(getAuthContext);
const findFirstMock = vi.mocked(prisma.webhook.findFirst);
const findManyMock = vi.mocked(prisma.webhookDelivery.findMany);
const createMock = vi.mocked(prisma.webhookDelivery.create);
const updateMock = vi.mocked(prisma.webhookDelivery.update);
const auditLogCreateMock = vi.mocked(prisma.auditLog.create);
const deliverWebhookMock = vi.mocked(deliverWebhook);

const WEBHOOK = {
  id: "wh_1",
  userId: "user_1",
  url: "https://hook.example.com/receive",
  secret: "s-wh_1",
  isActive: true,
};

function deadLetterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dlv_1",
    webhookId: "wh_1",
    eventId: "evt_1",
    status: "DEAD_LETTER",
    attempts: 3,
    responseCode: 500,
    failureReason: "HTTP_ERROR",
    errorMessage: "HTTP 500",
    responseBody: "server error",
    targetUrl: WEBHOOK.url,
    deadLetteredAt: new Date("2026-09-28T00:00:00Z"),
    resolvedAt: null,
    redeliveryBatchId: null,
    deliveredAt: new Date("2026-09-28T00:00:00Z"),
    event: { id: "evt_1", event: "payment.created", timestamp: new Date("2026-09-27T23:59:00Z"), data: '{"id":"p_1"}' },
    ...overrides,
  };
}

function authedRequest(url: string, method: string): Request {
  const token = generateCsrfToken();
  return new Request(url, {
    method,
    headers: {
      "x-csrf-token": token,
      cookie: `__Host-csrf=${token}`,
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "user_1" } as never);
  findFirstMock.mockResolvedValue(WEBHOOK as never);
  createMock.mockResolvedValue({ id: "dlv_new" } as never);
  updateMock.mockResolvedValue({} as never);
  auditLogCreateMock.mockResolvedValue({} as never);
});

describe("GET /api/webhooks/[id]/dead-letters", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/webhooks/wh_1/dead-letters"), {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the webhook is not owned by the caller", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/webhooks/wh_1/dead-letters"), {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(400);
  });

  it("lists unresolved dead letters by default, retaining payload/response/failure reason", async () => {
    findManyMock.mockResolvedValueOnce([deadLetterRow()] as never);

    const res = await GET(new Request("http://localhost/api/webhooks/wh_1/dead-letters"), {
      params: Promise.resolve({ id: "wh_1" }),
    });
    expect(res.status).toBe(200);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          webhookId: "wh_1",
          status: "DEAD_LETTER",
          resolvedAt: null,
        }),
      })
    );

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "dlv_1",
      eventType: "payment.created",
      failureReason: "HTTP_ERROR",
      errorMessage: "HTTP 500",
      responseBodyExcerpt: "server error",
      targetUrl: WEBHOOK.url,
      resolvedAt: null,
    });
  });

  it("includes resolved dead letters when includeResolved=true", async () => {
    findManyMock.mockResolvedValueOnce([]);
    await GET(
      new Request("http://localhost/api/webhooks/wh_1/dead-letters?includeResolved=true"),
      { params: Promise.resolve({ id: "wh_1" }) }
    );

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { webhookId: "wh_1", status: "DEAD_LETTER" },
      })
    );
  });
});

describe("POST /api/webhooks/[id]/dead-letters/redeliver", () => {
  it("returns 403 on CSRF failure", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/wh_1/dead-letters/redeliver", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when there are no unresolved dead letters", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const res = await POST(
      authedRequest("http://localhost/api/webhooks/wh_1/dead-letters/redeliver", "POST"),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("redelivers, marks succeeded deliveries resolved, and writes one audit log entry for the batch", async () => {
    findManyMock.mockResolvedValueOnce([deadLetterRow()] as never);
    deliverWebhookMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      latencyMs: 10,
      attempts: 1,
    } as never);

    const res = await POST(
      authedRequest("http://localhost/api/webhooks/wh_1/dead-letters/redeliver", "POST"),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.attempted).toBe(1);
    expect(body.data.succeeded).toBe(1);
    expect(body.data.failed).toBe(0);
    expect(typeof body.data.redeliveryBatchId).toBe("string");

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh_1",
        eventId: "evt_1",
        status: "SUCCESS",
        redeliveredFromId: "dlv_1",
        redeliveryBatchId: body.data.redeliveryBatchId,
      }),
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "dlv_1" },
      data: { resolvedAt: expect.any(Date) },
    });

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "webhook:dead_letter_bulk_redeliver",
        actor: "user_1",
        target: "wh_1",
        details: expect.objectContaining({
          attempted: 1,
          succeeded: 1,
          failed: 0,
          deliveryIds: ["dlv_1"],
        }),
      }),
    });
  });

  it("keeps an unresolved dead letter unresolved when redelivery fails again", async () => {
    findManyMock.mockResolvedValueOnce([deadLetterRow()] as never);
    deliverWebhookMock.mockResolvedValueOnce({
      success: false,
      statusCode: 503,
      latencyMs: 8,
      attempts: 3,
      errorMessage: "HTTP 503",
      failureReason: "HTTP_ERROR",
      responseBody: "still down",
      durationMs: 8,
      error: "HTTP 503",
      request: {
        canonicalBody: "canonical",
        body: "body",
        signature: "sig",
        headers: {},
      },
    } as never);

    const res = await POST(
      authedRequest("http://localhost/api/webhooks/wh_1/dead-letters/redeliver", "POST"),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.succeeded).toBe(0);
    expect(body.data.failed).toBe(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "DEAD_LETTER", failureReason: "HTTP_ERROR" }),
    });
  });

  it("scopes redelivery to specific ids when provided", async () => {
    findManyMock.mockResolvedValueOnce([deadLetterRow({ id: "dlv_2" })] as never);
    deliverWebhookMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      latencyMs: 5,
      attempts: 1,
    } as never);

    const token = generateCsrfToken();
    const res = await POST(
      new Request("http://localhost/api/webhooks/wh_1/dead-letters/redeliver", {
        method: "POST",
        headers: {
          "x-csrf-token": token,
          cookie: `__Host-csrf=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids: ["dlv_2"] }),
      }),
      { params: Promise.resolve({ id: "wh_1" }) }
    );
    expect(res.status).toBe(200);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["dlv_2"] } }),
      })
    );
  });
});
