// SPDX-License-Identifier: MIT

/**
 * RFC 7807 problem details (issue #1364).
 *
 * The contract under test is the wire format, not just the object:
 *
 *   Content-Type: application/problem+json
 *   { type, title, status, detail, instance, code, requestId, errors? }
 *
 * The media type is asserted over a real HTTP server as well as on the
 * `Response` object, because `NextResponse.json()` sets `application/json` by
 * default — a helper that forgot to override it would pass a body-shape
 * assertion and still fail every client that switches on Content-Type.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  formatProblemDetails,
  problemBadRequest,
  problemConflict,
  problemFromError,
  problemFromLegacyResponse,
  problemFromZodError,
  problemNotFound,
  problemTypeFor,
  problemUnauthorized,
} from "@/lib/api-errors";
import {
  PROBLEM_CONTENT_TYPE,
  isProblemDetails,
  normalizeApiError,
} from "@/lib/problem-details";

/** Read the body of a Response as a problem document. */
async function readProblem(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

// ── Media type over HTTP ──────────────────────────────────────

describe("problem+json over a real HTTP connection", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(async (_req, res) => {
      // Reproduce what a Node server does with a route handler's Response:
      // copy the headers, then write the body.
      const problem = problemUnauthorized("Please connect a wallet.", {
        instance: "/api/payments",
      });
      res.statusCode = problem.status;
      problem.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await problem.text());
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves application/problem+json (not application/json)", async () => {
    const res = await fetch(`${baseUrl}/api/payments`);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe(PROBLEM_CONTENT_TYPE);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body).toMatchObject({
      type: "https://ophirpay.dev/problems/unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "Please connect a wallet.",
      instance: "/api/payments",
      code: "UNAUTHORIZED",
    });
  });
});

// ── Builder ───────────────────────────────────────────────────

describe("formatProblemDetails", () => {
  it("derives a stable type URI from the error code", () => {
    expect(problemTypeFor("MEMO_TOO_LONG")).toBe(
      "https://ophirpay.dev/problems/memo-too-long"
    );
    expect(problemTypeFor(undefined)).toBe("about:blank");
  });

  it("uses the canonical status title and a detail default", async () => {
    const response = formatProblemDetails({ status: 503 });
    expect(response.status).toBe(503);
    const body = await readProblem(response);
    expect(body.title).toBe("Service Unavailable");
    // Never leaves `detail` missing for a client that displays it directly.
    expect(body.detail).toBe("Service Unavailable");
    expect(body.type).toBe("about:blank");
  });

  it("carries Retry-After and other headers through", async () => {
    const response = problemConflict("Still processing", {
      code: "OPERATION_IN_PROGRESS",
      headers: { "Retry-After": "5" },
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("5");
    const body = await readProblem(response);
    expect(body.code).toBe("OPERATION_IN_PROGRESS");
  });

  it("maps Zod issues onto per-field errors, not one joined string", async () => {
    const schema = z.object({
      amount: z.number().positive("Amount must be greater than zero"),
      memo: z.string().min(1, "Memo is required"),
    });
    const parsed = schema.safeParse({ amount: -1, memo: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const response = problemFromZodError(parsed.error, {
      instance: "/api/payments",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(PROBLEM_CONTENT_TYPE);

    const body = (await response.json()) as {
      title: string;
      detail: string;
      code: string;
      errors: { field: string; message: string; code?: string }[];
    };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.detail).toBe("Request validation failed for 2 fields");
    expect(body.errors).toEqual([
      expect.objectContaining({
        field: "amount",
        message: "Amount must be greater than zero",
      }),
      expect.objectContaining({ field: "memo", message: "Memo is required" }),
    ]);
  });

  it("reports a whole-body failure as (body) rather than an empty path", async () => {
    const parsed = z.string().min(5, "Too short").safeParse("");
    if (parsed.success) throw new Error("expected a validation failure");

    const body = (await problemFromZodError(parsed.error).json()) as {
      detail: string;
      errors: { field: string }[];
    };
    expect(body.errors[0].field).toBe("(body)");
    expect(body.detail).toBe("Too short");
  });
});

// ── Error classification ──────────────────────────────────────

describe("problemFromError", () => {
  it("maps an unexpected error to a logged 500", async () => {
    const response = problemFromError(new Error("kaboom"), "/api/payments");
    expect(response.status).toBe(500);
    const body = await readProblem(response);
    expect(body.code).toBe("INTERNAL_ERROR");
    // Test runs are not production, so the message is preserved for debugging.
    expect(body.detail).toBe("kaboom");
    expect(body.instance).toBe("/api/payments");
  });

  it("maps a real Prisma P2025 to 404 without leaking the raw error", async () => {
    // A genuine Prisma client error (not a look-alike): the classifier detects
    // it by constructor name and `handlePrismaError` by `instanceof`.
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "An operation failed because it depends on one or more records that were required but not found.",
      { code: "P2025", clientVersion: "6.5.0" }
    );

    const response = problemFromError(prismaError);
    expect(response.status).toBe(404);
    expect(await readProblem(response)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      detail: "Record not found.",
    });
  });

  it("delegates Zod errors to the validation builder", async () => {
    const parsed = z.number().safeParse("nope");
    if (parsed.success) throw new Error("expected a validation failure");
    const response = problemFromError(parsed.error, "/api/payments");
    expect(response.status).toBe(400);
    expect((await readProblem(response)).code).toBe("VALIDATION_ERROR");
  });
});

// ── Legacy middleware adaptation ──────────────────────────────

describe("problemFromLegacyResponse", () => {
  it("re-renders a legacy envelope (the CSRF guard) as problem details", async () => {
    const legacy = Response.json(
      {
        success: false,
        error: {
          code: "CSRF_INVALID",
          message: "Invalid or missing CSRF token.",
        },
      },
      { status: 403, headers: { "Retry-After": "1" } }
    );

    const response = await problemFromLegacyResponse(legacy, "/api/payments");
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(PROBLEM_CONTENT_TYPE);
    // Non-content headers survive the conversion.
    expect(response.headers.get("retry-after")).toBe("1");

    const body = await readProblem(response);
    expect(body).toMatchObject({
      status: 403,
      code: "CSRF_INVALID",
      detail: "Invalid or missing CSRF token.",
      instance: "/api/payments",
      type: "https://ophirpay.dev/problems/csrf-invalid",
    });
  });

  it("falls back to the status title for a non-JSON body", async () => {
    const response = await problemFromLegacyResponse(
      new Response("<html>bad gateway</html>", { status: 502 })
    );
    expect(response.status).toBe(502);
    const body = await readProblem(response);
    expect(body.title).toBe("Server Error");
    expect(body.detail).toBe("Server Error");
  });

  it("carries legacy field details across as errors[]", async () => {
    const legacy = Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: [{ path: "memo", message: "Memo must be 28 bytes or fewer" }],
        },
      },
      { status: 400 }
    );

    const body = (await (
      await problemFromLegacyResponse(legacy)
    ).json()) as { errors?: { field: string; message: string }[] };
    expect(body.errors).toEqual([
      { field: "memo", message: "Memo must be 28 bytes or fewer" },
    ]);
  });
});

// ── Client-side normalization ─────────────────────────────────

describe("normalizeApiError", () => {
  it("reads problem details", () => {
    const problem = {
      type: "https://ophirpay.dev/problems/memo-too-long",
      title: "Bad Request",
      status: 400,
      detail: "Memo must be 28 bytes or fewer",
      code: "MEMO_TOO_LONG",
      errors: [{ field: "memo", message: "too long" }],
    };
    expect(isProblemDetails(problem)).toBe(true);
    expect(normalizeApiError(problem, 400)).toEqual({
      code: "MEMO_TOO_LONG",
      message: "Memo must be 28 bytes or fewer",
      fields: [{ field: "memo", message: "too long" }],
    });
  });

  it("still reads the legacy envelope", () => {
    expect(
      normalizeApiError(
        { success: false, error: { code: "CSRF_INVALID", message: "bad token" } },
        403
      )
    ).toEqual({ code: "CSRF_INVALID", message: "bad token" });
  });

  it("falls back to the status when the body is unusable", () => {
    expect(normalizeApiError(null, 502)).toEqual({
      code: "HTTP_502",
      message: "Request failed with status 502",
    });
    expect(normalizeApiError("<html>", 500).code).toBe("HTTP_500");
  });

  it("does not mistake a legacy success envelope for a problem", () => {
    expect(isProblemDetails({ success: true, data: [] })).toBe(false);
  });
});

// ── Convenience builders keep the catalog codes ───────────────

describe("convenience builders", () => {
  it("use the documented error codes", async () => {
    expect(await readProblem(problemNotFound("Payment"))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      detail: "Payment not found",
    });
    expect(await readProblem(problemBadRequest("Bad body"))).toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    expect(
      await readProblem(problemUnauthorized())
    ).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      detail:
        "Authentication required. Connect your wallet or provide an API key.",
    });
  });
});
