// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const deliverMock = vi.fn();
const storeMock = vi.fn();
const recordDeliveryMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: { webhook: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/webhook-deliver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/webhook-deliver")>("@/lib/webhook-deliver");
  return {
    ...actual,
    deliverWebhook: (...args: unknown[]) => deliverMock(...args),
  };
});

vi.mock("@/lib/webhook-event-store", () => ({
  storeWebhookEvent: (...args: unknown[]) => storeMock(...args),
  recordWebhookDelivery: (...args: unknown[]) => recordDeliveryMock(...args),
}));

// Import after mocks are registered.
const { GET, POST } = await import("@/app/api/webhooks/[id]/test/route");

const makePostRequest = (body?: unknown) =>
  new Request("http://localhost/api/webhooks/wh-1/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

const makeGetRequest = (queryString = "") =>
  new Request(`http://localhost/api/webhooks/wh-1/test${queryString}`, { method: "GET" });

const callPost = async (id: string, reqBody?: unknown) => {
  const res = await POST(makePostRequest(reqBody), { params: Promise.resolve({ id }) });
  return {
    res,
    body: (await res.json()) as {
      data?: {
        delivered?: boolean;
        status?: string;
        statusCode?: number;
        latencyMs?: number;
        durationMs?: number;
        responseBody?: string;
        deliveryId?: string;
        event?: string;
        test?: boolean;
      };
      error?: { message?: string };
    },
  };
};

const callGet = async (id: string, queryString = "") => {
  const res = await GET(makeGetRequest(queryString), { params: Promise.resolve({ id }) });
  return {
    res,
    body: (await res.json()) as {
      data?: {
        url?: string;
        urlGuard?: { safe: boolean; reason?: string };
        event?: string;
        headers?: Record<string, string>;
        canonicalPayload?: { signature?: string };
        canonicalJson?: string;
        outgoingBody?: string;
        signature?: string;
      };
      error?: { message?: string };
    },
  };
};

describe("POST /api/webhooks/[id]/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret-123",
      isActive: true,
    });
    deliverMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      latencyMs: 35,
      attempts: 1,
      responseBody: '{"received": true}',
    });
    storeMock.mockResolvedValue("event-123");
    recordDeliveryMock.mockResolvedValue("del-456");
  });

  it("delivers a test event and reports success with status, latency, responseBody, and deliveryId", async () => {
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.delivered).toBe(true);
    expect(body.data?.status).toBe("delivered");
    expect(body.data?.test).toBe(true);
    expect(body.data?.event).toBe("payment.completed");
    expect(body.data?.statusCode).toBe(200);
    expect(body.data?.latencyMs).toBe(35);
    expect(body.data?.responseBody).toBe('{"received": true}');
    expect(body.data?.deliveryId).toBe("del-456");
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(storeMock).toHaveBeenCalledTimes(1);
    expect(recordDeliveryMock).toHaveBeenCalledTimes(1);
  });

  it("handles boolean return from deliverWebhook for backwards compatibility", async () => {
    deliverMock.mockResolvedValueOnce(true);
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.delivered).toBe(true);
    expect(body.data?.status).toBe("delivered");
  });

  it("returns 404 when the webhook does not belong to the user", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const { res, body } = await callPost("missing");
    expect(res.status).toBe(404);
    expect(body.error?.message).toMatch(/not found/i);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("rejects a paused webhook before any delivery", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret-123",
      isActive: false,
    });
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(400);
    expect(body.error?.message).toMatch(/paused/i);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("rejects a blocked destination URL before making any network request", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "wh-1",
      url: "http://127.0.0.1:8080/internal",
      secret: "secret-123",
      isActive: true,
    });
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(400);
    expect(body.error?.message).toMatch(/private\/internal|SSRF guard/i);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("reports failure when the endpoint does not accept the payload", async () => {
    deliverMock.mockResolvedValueOnce({
      success: false,
      statusCode: 500,
      latencyMs: 120,
      attempts: 1,
      responseBody: "Internal Server Error",
    });
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.delivered).toBe(false);
    expect(body.data?.status).toBe("failed");
    expect(body.data?.statusCode).toBe(500);
    expect(body.data?.responseBody).toBe("Internal Server Error");
  });
});

describe("GET /api/webhooks/[id]/test (Delivery Preview)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret-123",
      isActive: true,
    });
  });

  it("returns delivery preview with canonicalization and byte-for-byte wire body", async () => {
    const { res, body } = await callGet("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.url).toBe("https://example.com/hook");
    expect(body.data?.urlGuard?.safe).toBe(true);
    expect(body.data?.headers?.["Content-Type"]).toBe("application/json");
    expect(body.data?.headers?.["X-OphirPay-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data?.canonicalPayload?.signature).toBe("");
    expect(body.data?.canonicalJson).toContain('"signature": ""');
    expect(body.data?.outgoingBody).toContain(body.data?.signature);
  });

  it("flags blocked destination URLs in the preview before any dispatch", async () => {
    findFirstMock.mockResolvedValueOnce({
      id: "wh-1",
      url: "http://localhost:3000/hook",
      secret: "secret-123",
      isActive: true,
    });
    const { res, body } = await callGet("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.urlGuard?.safe).toBe(false);
    expect(body.data?.urlGuard?.reason).toMatch(/reserved\/internal domain/i);
  });
});
