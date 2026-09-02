// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const deliverMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: { webhook: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/webhook-deliver", () => ({
  deliverWebhook: (...args: unknown[]) => deliverMock(...args),
}));

// Import after mocks are registered.
const { POST } = await import("@/app/api/webhooks/[id]/test/route");

const makeRequest = () =>
  new Request("http://localhost/api/webhooks/wh-1/test", { method: "POST" });

const callPost = async (id: string) => {
  const res = await POST(makeRequest(), { params: Promise.resolve({ id }) });
  return { res, body: (await res.json()) as { data?: Record<string, unknown>; error?: { message?: string } } };
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
    deliverMock.mockResolvedValue(true);
  });

  it("delivers a test event and reports success with a test marker", async () => {
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.delivered).toBe(true);
    expect(body.data?.status).toBe("delivered");
    expect(body.data?.test).toBe(true);
    expect(body.data?.event).toBe("payment.completed");
    // The integrator's endpoint was actually called.
    expect(deliverMock).toHaveBeenCalledTimes(1);
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
    const { res } = await callPost("wh-1");
    expect(res.status).toBe(400);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("reports failure when the endpoint does not accept the payload", async () => {
    deliverMock.mockResolvedValueOnce(false);
    const { res, body } = await callPost("wh-1");
    expect(res.status).toBe(200);
    expect(body.data?.delivered).toBe(false);
    expect(body.data?.status).toBe("failed");
  });
});
