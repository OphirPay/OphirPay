// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

const {
  mockClaim,
  mockPaymentCreate,
  mockGetAuthContext,
  mockInvalidateCaches,
  mockDispatchWebhook,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockPaymentCreate: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockInvalidateCaches: vi.fn(),
  mockDispatchWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { create: mockPaymentCreate } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/idempotency", () => ({
  claimIdempotencyKey: mockClaim,
  IDEMPOTENCY_RESPONSE_TTL_SECONDS: 24 * 60 * 60,
  IDEMPOTENCY_LOCK_TTL_SECONDS: 120,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: mockDispatchWebhook,
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: mockInvalidateCaches,
}));

import { POST as createPayment } from "@/app/api/payments/route";
import { generateCsrfToken } from "@/lib/csrf";
import { IDEMPOTENCY_RESPONSE_TTL_SECONDS } from "@/lib/idempotency";

const USER_ID = "user-test-1961";
const IDEMPOTENCY_KEY = "idempotency-test-key-1961";
const DEST = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SOURCE = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/api/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validPayload() {
  return {
    amount: 100,
    sourceAccountId: SOURCE,
    destAddress: DEST,
    assetCode: "XLM",
    description: "Payment for order 1961",
  };
}

describe("Issue #1961: Idempotency-Key support on payment submission routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
    mockInvalidateCaches.mockResolvedValue(undefined);
    mockPaymentCreate.mockResolvedValue({
      id: "pay_1961",
      amount: 100,
      assetCode: "XLM",
      status: "CREATED",
      createdAt: new Date("2026-11-19T00:00:00.000Z"),
    });
  });

  it("successfully stores payment and remembers response with 24-hour TTL on first submission", async () => {
    const remember = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    mockClaim.mockResolvedValue({
      status: "acquired",
      remember,
      release,
    });

    const res = await createPayment(
      makeRequest(validPayload(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.status).toBe(201);
    expect(mockClaim).toHaveBeenCalledWith(USER_ID, IDEMPOTENCY_KEY);
    expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: IDEMPOTENCY_KEY,
          amount: 100,
        }),
      })
    );
    expect(remember).toHaveBeenCalledTimes(1);
    expect(IDEMPOTENCY_RESPONSE_TTL_SECONDS).toBe(86400);
  });

  it("returns cached response with Idempotent-Replay header on duplicate requests", async () => {
    const cachedBody = {
      success: true,
      data: { id: "pay_1961", amount: 100, status: "CREATED" },
      meta: { timestamp: "2026-11-19T00:00:00.000Z" },
    };

    mockClaim.mockResolvedValue({
      status: "replay",
      response: { status: 201, body: cachedBody },
    });

    const res = await createPayment(
      makeRequest(validPayload(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.headers.get("Idempotent-Replay")).toBe("true");
    expect(res.headers.get("Idempotency-Replay")).toBe("true");
    const json = await res.json();
    expect(json).toEqual(cachedBody);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("returns 409 with Retry-After when duplicate request is still in flight", async () => {
    mockClaim.mockResolvedValue({
      status: "in-flight",
      retryAfterSeconds: 5,
    });

    const res = await createPayment(
      makeRequest(validPayload(), { "Idempotency-Key": IDEMPOTENCY_KEY })
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid key shorter than 8 characters", async () => {
    const res = await createPayment(
      makeRequest(validPayload(), { "Idempotency-Key": "short" })
    );

    expect(res.status).toBe(400);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });
});
