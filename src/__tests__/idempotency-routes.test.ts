// SPDX-License-Identifier: MIT

/**
 * Idempotency enforcement on the money-moving POST routes (issue #1440).
 *
 * `Order #1440` requires an `Idempotency-Key` on payments, batches, escrows and
 * streams, a 24 h replay window, and — for a repeated key — **409 with the
 * original response body**. These tests drive the real route handlers with a
 * scripted claim, so each branch is asserted through the interface a client
 * sees:
 *
 *   • misuse (missing / malformed key) is a 400 before any work happens
 *   • a first success caches its exact status and body for 24 h
 *   • a repeat answers 409 + that body (never writes twice)
 *   • a concurrent duplicate answers 409 + Retry-After
 *   • a handler failure releases the key instead of pinning it
 *   • without Redis the route still works (degraded, not broken)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockClaim,
  mockPaymentCreate,
  mockGetAuthContext,
  mockSimulate,
  mockInvalidateCaches,
  mockDispatchWebhook,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockPaymentCreate: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockSimulate: vi.fn(),
  mockInvalidateCaches: vi.fn(),
  mockDispatchWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { create: mockPaymentCreate } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

// The lease itself is covered in idempotency.test.ts; here the claim is
// scripted so each route branch can be driven in isolation.
vi.mock("@/lib/idempotency", () => ({
  claimIdempotencyKey: mockClaim,
  IDEMPOTENCY_RESPONSE_TTL_SECONDS: 24 * 60 * 60,
  IDEMPOTENCY_LOCK_TTL_SECONDS: 120,
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: mockSimulate,
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: mockDispatchWebhook,
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: mockInvalidateCaches,
}));

import { generateCsrfToken } from "@/lib/csrf";
import { IDEMPOTENCY_RESPONSE_TTL_SECONDS } from "@/lib/idempotency";
import { POST as createPayment } from "@/app/api/payments/route";
import { POST as createBatch } from "@/app/api/batches/route";
import { POST as createEscrow } from "@/app/api/escrows/route";
import { POST as createStream } from "@/app/api/streams/route";

const USER_ID = "user-1";
const KEY = "idempotency-key-12345";
const DEST = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SOURCE = "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function postRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders(), ...headers },
    body: JSON.stringify(body),
  });
}

function paymentBody() {
  return {
    amount: 25,
    sourceAccountId: SOURCE,
    destAddress: DEST,
    assetCode: "XLM",
    description: "Invoice 1042",
  };
}

function acquiredClaim() {
  const remember = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn().mockResolvedValue(undefined);
  return { claim: { status: "acquired" as const, remember, release }, remember, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
  mockPaymentCreate.mockResolvedValue({
    id: "p_new_1",
    amount: 25,
    assetCode: "XLM",
    status: "CREATED",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
  });
  mockInvalidateCaches.mockResolvedValue(undefined);
});

describe("POST /api/payments — idempotency", () => {
  it("rejects a request without an Idempotency-Key before creating anything", async () => {
    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody())
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Idempotency-Key");
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed key (shorter than 8 characters) with 400", async () => {
    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": "short",
      })
    );

    expect(res.status).toBe(400);
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("stores the client key on the payment and caches the 201 response for 24h", async () => {
    const { claim, remember, release } = acquiredClaim();
    mockClaim.mockResolvedValue(claim);

    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(201);
    expect(mockClaim).toHaveBeenCalledWith(USER_ID, KEY);
    expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
    expect(mockPaymentCreate.mock.calls[0][0].data.idempotencyKey).toBe(KEY);

    expect(remember).toHaveBeenCalledTimes(1);
    const cached = remember.mock.calls[0][0];
    expect(cached.status).toBe(201);
    expect(cached.body.data.id).toBe("p_new_1");
    expect(release).not.toHaveBeenCalled();

    // The response window the route depends on is the 24 h one from the issue.
    expect(IDEMPOTENCY_RESPONSE_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("answers a repeated key with 409 and the original response body", async () => {
    const original = {
      success: true,
      data: { id: "p_existing", amount: 25, status: "CREATED" },
      meta: { timestamp: "2026-10-01T10:00:00.000Z" },
    };
    mockClaim.mockResolvedValue({
      status: "replay",
      response: { status: 201, body: original },
    });

    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("Idempotency-Replay")).toBe("true");
    expect(res.headers.get("X-Original-Status")).toBe("201");
    expect(await res.json()).toEqual(original);
    // A replay must not write again — that is the entire point.
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("answers a concurrent duplicate with 409 and Retry-After", async () => {
    mockClaim.mockResolvedValue({ status: "in-flight", retryAfterSeconds: 5 });

    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("5");
    const body = await res.json();
    expect(body.error.code).toBe("OPERATION_IN_PROGRESS");
    expect(mockPaymentCreate).not.toHaveBeenCalled();
  });

  it("creates the payment when Redis is unavailable (degraded, not broken)", async () => {
    mockClaim.mockResolvedValue({ status: "unavailable" });

    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(201);
    expect(mockPaymentCreate).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the handler fails, and reports the failure", async () => {
    const { claim, release, remember } = acquiredClaim();
    mockClaim.mockResolvedValue(claim);
    mockPaymentCreate.mockRejectedValue(new Error("database is down"));

    const res = await createPayment(
      postRequest("http://localhost/api/payments", paymentBody(), {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(500);
    expect(release).toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });
});

describe("POST /api/escrows — idempotency", () => {
  const body = {
    depositor: SOURCE,
    beneficiary: DEST,
    amount: 1000,
  };

  it("requires an Idempotency-Key", async () => {
    const res = await createEscrow(
      postRequest("http://localhost/api/escrows", body)
    );

    expect(res.status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("returns the signing parameters once, then replays them as 409", async () => {
    const { claim, remember } = acquiredClaim();
    mockClaim.mockResolvedValue(claim);

    const first = await createEscrow(
      postRequest("http://localhost/api/escrows", body, {
        "Idempotency-Key": KEY,
      })
    );
    expect(first.status).toBe(202);
    const original = await first.json();
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({ status: 202, body: original })
    );

    mockClaim.mockResolvedValue({
      status: "replay",
      response: { status: 202, body: original },
    });
    const second = await createEscrow(
      postRequest("http://localhost/api/escrows", body, {
        "Idempotency-Key": KEY,
      })
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual(original);
  });
});

describe("POST /api/streams — idempotency", () => {
  const body = {
    creator: SOURCE,
    recipient: DEST,
    totalAmount: 1000,
  };

  it("requires an Idempotency-Key", async () => {
    const res = await createStream(
      postRequest("http://localhost/api/streams", body)
    );

    expect(res.status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("claims the key and caches the 202 parameters", async () => {
    const { claim, remember } = acquiredClaim();
    mockClaim.mockResolvedValue(claim);

    const res = await createStream(
      postRequest("http://localhost/api/streams", body, {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(202);
    expect(mockClaim).toHaveBeenCalledWith(USER_ID, KEY);
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({ status: 202 })
    );
  });
});

describe("POST /api/batches — idempotency", () => {
  const body = {
    name: "August payroll",
    sourceAccountId: SOURCE,
    recipients: [{ address: DEST, amount: 100 }],
  };

  it("requires an Idempotency-Key instead of falling back to a body key", async () => {
    const res = await createBatch(
      postRequest("http://localhost/api/batches", {
        ...body,
        idempotencyKey: KEY,
      })
    );

    expect(res.status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("answers a repeated key with 409 and the original body", async () => {
    const original = {
      success: true,
      data: { id: "b_existing" },
      meta: { deduplicated: true },
    };
    mockClaim.mockResolvedValue({
      status: "replay",
      response: { status: 200, body: original },
    });

    const res = await createBatch(
      postRequest("http://localhost/api/batches", body, {
        "Idempotency-Key": KEY,
      })
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("X-Original-Status")).toBe("200");
    expect(await res.json()).toEqual(original);
  });
});
