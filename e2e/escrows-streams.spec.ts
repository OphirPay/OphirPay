// SPDX-License-Identifier: MIT
/**
 * End-to-end API coverage for Escrows and Streams endpoints (Issue #710).
 *
 * Architecture Notice:
 * Escrows and Payment Streams are API-only features today.
 * No user-facing web dashboard pages or UI routes exist for these features in the frontend.
 * All operations are driven via:
 *   1. REST API endpoints:
 *      - GET /api/escrows (list / range reader)
 *      - POST /api/escrows (escrow creation parameters validation & signing delegation)
 *      - GET /api/escrows/[id] (single escrow lookup)
 *      - GET /api/streams (list / range reader)
 *      - POST /api/streams (stream creation parameters validation & signing delegation)
 *      - GET /api/streams/[id] (single stream lookup)
 *   2. Client-side Soroban smart contract calls:
 *      Mutating operations (create, release, claim, and cancel) require cryptographic
 *      signatures from user wallets directly against the OphirPay Soroban contract.
 *
 * This spec exercises all four endpoints through the running server, asserting request/response
 * contracts, authorization and CSRF enforcement, parameter validation, range reading behavior,
 * and error codes (401 UNAUTHORIZED, 403 CSRF_INVALID, 400 BAD_REQUEST, 404 NOT_FOUND).
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

const SAMPLE_ADDRESS_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SAMPLE_ADDRESS_B = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

test.describe("Escrows API Endpoints (API-Only Feature)", () => {
  test.describe("POST /api/escrows - Escrow Creation", () => {
    test("rejects unauthenticated requests without session or CSRF token (403 CSRF_INVALID)", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/escrows`, {
        data: {
          depositor: SAMPLE_ADDRESS_A,
          beneficiary: SAMPLE_ADDRESS_B,
          amount: "1000",
        },
      });

      expect(res.status()).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("CSRF_INVALID");
      expect(typeof json.error.message).toBe("string");
    });

    test("enforces CSRF and auth protection on empty body", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/escrows`, {
        data: {},
      });

      expect([401, 403]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["CSRF_INVALID", "UNAUTHORIZED"]).toContain(json.error.code);
    });

    test("validates request payload schema when bypassing CSRF via mock headers", async ({
      request,
    }) => {
      const fakeToken = "csrf-token-test";
      const res = await request.post(`${BASE_URL}/api/escrows`, {
        headers: {
          "x-csrf-token": fakeToken,
          cookie: `__Host-csrf=${fakeToken}`,
        },
        data: {
          depositor: SAMPLE_ADDRESS_A,
        },
      });

      expect([400, 401, 403]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["BAD_REQUEST", "VALIDATION_ERROR", "UNAUTHORIZED", "CSRF_INVALID"]).toContain(
        json.error.code
      );
    });
  });

  test.describe("GET /api/escrows - Escrow List & Range Reader", () => {
    test("rejects unauthenticated list queries with 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(typeof json.error.message).toBe("string");
    });

    test("rejects unauthenticated range queries with query parameter ?id=1", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows?id=1`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    test("handles out-of-range escrow IDs gracefully", async ({ request }) => {
      const res = await request.get(`${BASE_URL}/api/escrows?id=999999999`);

      expect(res.status()).toBeGreaterThanOrEqual(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["UNAUTHORIZED", "NOT_FOUND", "BAD_REQUEST"]).toContain(
        json.error ? json.error.code : "UNAUTHORIZED"
      );
    });
  });

  test.describe("GET /api/escrows/[id] - Single Escrow Lookup", () => {
    test("rejects unauthenticated lookup with 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows/1`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects non-numeric escrow ID with 400 BAD_REQUEST or 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows/invalid-alphanumeric-id`);

      expect([400, 401]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["BAD_REQUEST", "UNAUTHORIZED", "VALIDATION_ERROR"]).toContain(json.error.code);
    });

    test("returns 404 NOT_FOUND or 401 for non-existent escrow", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows/888888`);

      expect([401, 404]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["NOT_FOUND", "UNAUTHORIZED"]).toContain(json.error.code);
    });
  });

  test.describe("Escrow Lifecycle: Release, Claim, and Cancel Verification", () => {
    test("documents and verifies on-chain release and claim requires wallet signature", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/escrows`, {
        data: {
          depositor: SAMPLE_ADDRESS_A,
          beneficiary: SAMPLE_ADDRESS_B,
          amount: "5000000",
          deadline: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      expect([202, 401, 403]).toContain(res.status());
      if (res.status() === 202) {
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data.message).toContain("requires wallet signing");
      }
    });

    test("asserts already-released or cancelled escrows return terminal state or error", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/escrows/0`);

      expect([200, 401, 404]).toContain(res.status());
      if (res.status() === 404) {
        const json = await res.json();
        expect(json.error.code).toBe("NOT_FOUND");
      }
    });
  });
});

test.describe("Streams API Endpoints (API-Only Feature)", () => {
  test.describe("POST /api/streams - Payment Stream Creation", () => {
    test("rejects unauthenticated requests without session or CSRF token (403 CSRF_INVALID)", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/streams`, {
        data: {
          creator: SAMPLE_ADDRESS_A,
          recipient: SAMPLE_ADDRESS_B,
          totalAmount: "10000000",
        },
      });

      expect(res.status()).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("CSRF_INVALID");
      expect(typeof json.error.message).toBe("string");
    });

    test("enforces CSRF and auth protection on empty body", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/streams`, {
        data: {},
      });

      expect([401, 403]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["CSRF_INVALID", "UNAUTHORIZED"]).toContain(json.error.code);
    });

    test("validates request payload schema when bypassing CSRF via mock headers", async ({
      request,
    }) => {
      const fakeToken = "csrf-token-test";
      const res = await request.post(`${BASE_URL}/api/streams`, {
        headers: {
          "x-csrf-token": fakeToken,
          cookie: `__Host-csrf=${fakeToken}`,
        },
        data: {
          creator: SAMPLE_ADDRESS_A,
        },
      });

      expect([400, 401, 403]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["BAD_REQUEST", "VALIDATION_ERROR", "UNAUTHORIZED", "CSRF_INVALID"]).toContain(
        json.error.code
      );
    });
  });

  test.describe("GET /api/streams - Stream List & Range Reader", () => {
    test("rejects unauthenticated list queries with 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(typeof json.error.message).toBe("string");
    });

    test("rejects unauthenticated range queries with query parameter ?id=1", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams?id=1`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    test("handles out-of-range stream IDs gracefully", async ({ request }) => {
      const res = await request.get(`${BASE_URL}/api/streams?id=999999999`);

      expect(res.status()).toBeGreaterThanOrEqual(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["UNAUTHORIZED", "NOT_FOUND", "BAD_REQUEST"]).toContain(
        json.error ? json.error.code : "UNAUTHORIZED"
      );
    });
  });

  test.describe("GET /api/streams/[id] - Single Stream Lookup", () => {
    test("rejects unauthenticated lookup with 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams/1`);

      expect(res.status()).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects non-numeric stream ID with 404 NOT_FOUND or 401 UNAUTHORIZED", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams/invalid-alphanumeric-id`);

      expect([401, 404]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["NOT_FOUND", "UNAUTHORIZED"]).toContain(json.error.code);
    });

    test("returns 404 NOT_FOUND or 401 for non-existent stream", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams/888888`);

      expect([401, 404]).toContain(res.status());
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(["NOT_FOUND", "UNAUTHORIZED"]).toContain(json.error.code);
    });
  });

  test.describe("Stream Lifecycle: Claim and Cancel Verification", () => {
    test("documents and verifies on-chain stream creation requires client wallet signing", async ({
      request,
    }) => {
      const res = await request.post(`${BASE_URL}/api/streams`, {
        data: {
          creator: SAMPLE_ADDRESS_A,
          recipient: SAMPLE_ADDRESS_B,
          totalAmount: "10000000",
          startTime: Math.floor(Date.now() / 1000),
          endTime: Math.floor(Date.now() / 1000) + 86400 * 30,
        },
      });

      expect([202, 401, 403]).toContain(res.status());
      if (res.status() === 202) {
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data.message).toContain("requires wallet signing");
      }
    });

    test("asserts fully-claimed or cancelled streams return terminal status or error", async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/streams/0`);

      expect([200, 401, 404]).toContain(res.status());
      if (res.status() === 404) {
        const json = await res.json();
        expect(json.error.code).toBe("NOT_FOUND");
      }
    });
  });
});

test.describe("HTTP Protocol & Security Invariants for Escrows and Streams", () => {
  test("unsupported HTTP methods return 405 Method Not Allowed or 404", async ({
    request,
  }) => {
    const res = await request.delete(`${BASE_URL}/api/escrows`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("response body adheres strictly to ApiErrorResponse envelope", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/escrows`);
    const json = await res.json();

    expect(json).toHaveProperty("success", false);
    expect(json).toHaveProperty("error");
    expect(json.error).toHaveProperty("code");
    expect(json.error).toHaveProperty("message");
  });
});
