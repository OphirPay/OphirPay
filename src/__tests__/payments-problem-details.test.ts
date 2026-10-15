// SPDX-License-Identifier: MIT

// Issue #1364 — RFC 7807 problem details on payment mutation routes.
// Asserts Content-Type: application/problem+json and the RFC 7807 member
// shape (type/title/status[/detail/instance], `errors` extension member for
// validation field errors) across POST /api/payments, /cancel and /retry.

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreate,
  mockUpdateMany,
  mockFindFirst,
  mockFindUnique,
  mockGetAuthContext,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      create: mockCreate,
      updateMany: mockUpdateMany,
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: vi.fn(),
}));

import { generateCsrfToken } from "@/lib/csrf";
import { POST as POST_CREATE } from "@/app/api/payments/route";
import { POST as POST_CANCEL } from "@/app/api/payments/cancel/route";
import { POST as POST_RETRY } from "@/app/api/payments/retry/route";

const USER_ID = "user-1";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makeRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockCreate.mockResolvedValue({
    id: "p1",
    amount: 10,
    status: "CREATED",
    assetCode: "XLM",
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
  });
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindFirst.mockResolvedValue({ id: "p1", status: "CANCELLED" });
  mockFindUnique.mockResolvedValue({ id: "p1", status: "PENDING" });
});

describe("POST /api/payments — RFC 7807 problem details (#1364)", () => {
  it("returns application/problem+json with field errors on invalid body", async () => {
    const res = await POST_CREATE(
      makeRequest("http://localhost/api/payments", { amount: -5 })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.type).toContain("https://");
    expect(body.title).toBe("Bad Request");
    expect(body.status).toBe(400);
    expect(body.detail).toBeDefined();
    expect(body.instance).toBe("/api/payments");
    expect(Array.isArray(body.errors)).toBe(true);
    for (const e of body.errors) {
      expect(typeof e.path).toBe("string");
      expect(typeof e.message).toBe("string");
    }
    // No legacy envelope members on problem responses.
    expect(body.success).toBeUndefined();
    expect(body.error).toBeUndefined();
  });

  it("returns problem+json with 401 status when unauthenticated", async () => {
    mockGetAuthContext.mockResolvedValue(null);
    const res = await POST_CREATE(
      makeRequest("http://localhost/api/payments", { amount: 10 })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(401);
    expect(body.title).toBe("Unauthorized");
    expect(body.instance).toBe("/api/payments");
  });

  it("still returns a success envelope on the happy path", async () => {
    const res = await POST_CREATE(
      makeRequest("http://localhost/api/payments", {
        amount: 10,
        sourceAccountId:
          "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
        destAddress:
          "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe("POST /api/payments/cancel — RFC 7807 problem details (#1364)", () => {
  it("returns problem+json with field errors when txHash is missing", async () => {
    const res = await POST_CANCEL(
      makeRequest("http://localhost/api/payments/cancel", {})
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.instance).toBe("/api/payments/cancel");
    expect(body.errors).toEqual([
      { path: "txHash", message: expect.any(String) },
    ]);
    expect(body.errors[0].path).toBe("txHash");
  });

  it("returns problem+json 404 when payment does not exist", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const res = await POST_CANCEL(
      makeRequest("http://localhost/api/payments/cancel", {
        txHash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      })
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
    expect(body.instance).toBe("/api/payments/cancel");
  });
});

describe("POST /api/payments/retry — RFC 7807 problem details (#1364)", () => {
  it("returns problem+json with field errors on invalid body", async () => {
    const res = await POST_RETRY(
      makeRequest("http://localhost/api/payments/retry", { id: 123 })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(400);
    expect(body.instance).toBe("/api/payments/retry");
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("returns problem+json 409 when payment is not FAILED", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1", status: "PENDING" });
    const res = await POST_RETRY(
      makeRequest("http://localhost/api/payments/retry", { id: "p1" })
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(409);
    expect(body.title).toBe("Conflict");
    expect(body.detail).toContain("Only failed payments can be retried");
    expect(body.instance).toBe("/api/payments/retry");
  });

  it("returns problem+json 404 when payment does not exist", async () => {
    mockFindFirst.mockResolvedValue(null);
    const res = await POST_RETRY(
      makeRequest("http://localhost/api/payments/retry", { id: "nope" })
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(body.instance).toBe("/api/payments/retry");
  });
});
