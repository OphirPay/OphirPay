// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst, mockGetAuthContext, mockVerifyCsrf, mockDeliverWebhook } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockVerifyCsrf: vi.fn(),
  mockDeliverWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    webhook: { findFirst: mockFindFirst },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: mockVerifyCsrf,
}));

vi.mock("@/lib/webhook-deliver", () => ({
  deliverWebhook: mockDeliverWebhook,
}));

import { POST } from "@/app/api/webhooks/test/route";

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockReturnValue(null);
  mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
});

const createRequest = (body: unknown) =>
  new Request("http://localhost/api/webhooks/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/webhooks/test", () => {
  it("returns 400 when webhook is not found", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await POST(createRequest({ id: "wh-1", event: "payment.created" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when webhook is inactive", async () => {
    mockFindFirst.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret",
      isActive: false,
      events: JSON.stringify(["payment.created"]),
    });

    const res = await POST(createRequest({ id: "wh-1", event: "payment.created" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when webhook is not subscribed to the event", async () => {
    mockFindFirst.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret",
      isActive: true,
      events: JSON.stringify(["batch.created"]),
    });

    const res = await POST(createRequest({ id: "wh-1", event: "payment.created" }));
    expect(res.status).toBe(400);
  });

  it("delivers a test payload and reports success", async () => {
    mockFindFirst.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret",
      isActive: true,
      events: JSON.stringify(["payment.created"]),
    });
    mockDeliverWebhook.mockResolvedValue(true);

    const res = await POST(createRequest({ id: "wh-1", event: "payment.created" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.delivered).toBe(true);
    expect(json.data.event).toBe("payment.created");
    expect(mockDeliverWebhook).toHaveBeenCalledWith(
      "https://example.com/hook",
      "secret",
      expect.objectContaining({ event: "payment.created", data: expect.objectContaining({ test: true }) }),
      1
    );
  });

  it("reports failure when delivery fails", async () => {
    mockFindFirst.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "secret",
      isActive: true,
      events: JSON.stringify(["payment.created"]),
    });
    mockDeliverWebhook.mockResolvedValue(false);

    const res = await POST(createRequest({ id: "wh-1", event: "payment.created" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.delivered).toBe(false);
  });
});
