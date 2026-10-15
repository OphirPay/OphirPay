// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  problemErrorResponse,
  validationProblem,
  badRequestProblem,
  unauthorizedProblem,
  notFoundProblem,
  conflictProblem,
  serverProblem,
  legacyToProblemDetails,
  PROBLEM_JSON_CONTENT_TYPE,
  type ProblemDetails,
} from "@/lib/api-errors";

// ─── problemErrorResponse ────────────────────────────────────

describe("problemErrorResponse", () => {
  it("returns RFC 7807 problem details with correct content-type", async () => {
    const res = problemErrorResponse({
      type: "about:blank",
      title: "Test problem",
      status: 400,
      detail: "Something went wrong",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const json = await res.json();
    expect(json.type).toBe("about:blank");
    expect(json.title).toBe("Test problem");
    expect(json.status).toBe(400);
    expect(json.detail).toBe("Something went wrong");
  });

  it("includes optional instance and errors members", async () => {
    const res = problemErrorResponse({
      type: "about:blank",
      title: "Validation failed",
      status: 400,
      detail: "Invalid input",
      instance: "/api/payments",
      errors: [{ field: "amount", message: "Must be positive" }],
    });
    const json = await res.json();
    expect(json.instance).toBe("/api/payments");
    expect(json.errors).toEqual([{ field: "amount", message: "Must be positive" }]);
  });

  it("uses custom status override when provided", async () => {
    const res = problemErrorResponse(
      { type: "about:blank", title: "Test", status: 400 },
      422
    );
    expect(res.status).toBe(422);
  });
});

// ─── Convenience builders ────────────────────────────────────

describe("validationProblem", () => {
  it("maps ZodError to RFC 7807 with field errors", async () => {
    const schema = z.object({
      amount: z.number().positive(),
      name: z.string().min(1),
    });
    const result = schema.safeParse({ amount: -1, name: "" });
    expect(result.success).toBe(false);

    const res = validationProblem(result.error);
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe(PROBLEM_JSON_CONTENT_TYPE);

    const json = await res.json();
    expect(json.type).toBe("about:blank");
    expect(json.title).toBe("Validation failed");
    expect(json.status).toBe(400);
    expect(json.errors).toBeDefined();
    expect(json.errors.length).toBeGreaterThanOrEqual(2);
    expect(json.errors[0].field).toBe("amount");
    expect(json.errors[1].field).toBe("name");
  });
});

describe("badRequestProblem", () => {
  it("returns a 400 problem with detail", async () => {
    const res = badRequestProblem("Invalid cursor");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.title).toBe("Bad request");
    expect(json.detail).toBe("Invalid cursor");
  });
});

describe("unauthorizedProblem", () => {
  it("returns a 401 problem", async () => {
    const res = unauthorizedProblem("Authentication required");
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.title).toBe("Unauthorized");
    expect(json.detail).toBe("Authentication required");
  });

  it("uses default detail when none provided", async () => {
    const res = unauthorizedProblem();
    const json = await res.json();
    expect(json.detail).toBe("Authentication required");
  });
});

describe("notFoundProblem", () => {
  it("returns a 404 problem", async () => {
    const res = notFoundProblem("Payment not found");
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.title).toBe("Not found");
    expect(json.detail).toBe("Payment not found");
  });
});

describe("conflictProblem", () => {
  it("returns a 409 problem", async () => {
    const res = conflictProblem("Payment already completed");
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.title).toBe("Conflict");
    expect(json.detail).toBe("Payment already completed");
  });
});

describe("serverProblem", () => {
  it("returns a 500 problem", async () => {
    const res = serverProblem("Database connection failed");
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.title).toBe("Internal server error");
    expect(json.detail).toBe("Database connection failed");
  });
});

// ─── legacyToProblemDetails ──────────────────────────────────

describe("legacyToProblemDetails", () => {
  it("converts a legacy validation error to RFC 7807", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "email", message: "Invalid email" }],
      },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
    const json = await res.json();
    expect(json.title).toBe("Validation failed");
    expect(json.detail).toBe("Request validation failed");
    expect(json.errors).toEqual([{ field: "email", message: "Invalid email" }]);
  });

  it("maps BAD_REQUEST to 400", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "BAD_REQUEST", message: "Bad input" },
    });
    expect(res.status).toBe(400);
  });

  it("maps UNAUTHORIZED to 401", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Auth required" },
    });
    expect(res.status).toBe(401);
  });

  it("maps NOT_FOUND to 404", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "NOT_FOUND", message: "Not found" },
    });
    expect(res.status).toBe(404);
  });

  it("maps CONFLICT to 409", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "CONFLICT", message: "Conflict" },
    });
    expect(res.status).toBe(409);
  });

  it("maps RATE_LIMITED to 429", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many" },
    });
    expect(res.status).toBe(429);
  });

  it("maps unknown codes to 500", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: { code: "SOMETHING_ELSE", message: "Unknown" },
    });
    expect(res.status).toBe(500);
  });

  it("handles string path in details", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Failed",
        details: [{ path: "field", message: "bad" }],
      },
    });
    const json = await res.json();
    expect(json.errors).toEqual([{ field: "field", message: "bad" }]);
  });

  it("handles array path in details", async () => {
    const res = legacyToProblemDetails({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Failed",
        details: [{ path: ["body", "amount"], message: "bad" }],
      },
    });
    const json = await res.json();
    expect(json.errors).toEqual([{ field: "body.amount", message: "bad" }]);
  });
});
