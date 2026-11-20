// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

import { handleApiError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

describe("Issue #1955: Structured JSON error logger for unhandled route exceptions", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs unhandled exceptions in structured JSON format with required fields", () => {
    const error = new Error("Database query failed");
    const req = new Request("http://localhost/api/payments/test", {
      method: "POST",
      headers: { "x-request-id": "req-12345" },
    });

    logError(error, req, { requestId: "req-12345" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logLine = errorSpy.mock.calls[0][0];

    // Must be valid JSON
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(logLine);
    }).not.toThrow();

    parsed = JSON.parse(logLine);
    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("Database query failed");
    expect(typeof parsed.timestamp).toBe("string");

    const context = parsed.context as Record<string, unknown>;
    expect(context).toBeDefined();
    expect(context.method).toBe("POST");
    expect(context.path).toBe("/api/payments/test");
    expect(context.requestId).toBe("req-12345");
    expect(context.error).toBe("Database query failed");
    expect(context.stack).toBeDefined();
    expect(typeof context.stack).toBe("string");
  });

  it("redacts sensitive fields and authorization secrets from structured logs", () => {
    const error = new Error("Auth token invalid");
    const contextWithSecrets = {
      authorization: "Bearer secret-token-123",
      cookie: "session=xyz987; token=abc123",
      apiKey: "op_live_secretkey_12345",
      password: "SuperSecretPassword123!",
      email: "user@example.com",
      safeParam: "allowed-value",
    };

    logError(error, { method: "GET", path: "/api/keys" }, contextWithSecrets);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    const loggedContext = parsed.context as Record<string, unknown>;

    expect(loggedContext.authorization).toBe("[REDACTED]");
    expect(loggedContext.cookie).toBe("[REDACTED]");
    expect(loggedContext.apiKey).toBe("[REDACTED]");
    expect(loggedContext.password).toBe("[REDACTED]");
    expect(loggedContext.email).toBe("[REDACTED]");
    expect(loggedContext.safeParam).toBe("allowed-value");
  });

  it("integrates seamlessly into handleApiError without throwing", () => {
    const error = new Error("Unhandled route exception");
    const response = handleApiError(error, "GET /api/test");

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsed.level).toBe("error");
    expect(parsed.context.error).toBe("Unhandled route exception");
  });
});
