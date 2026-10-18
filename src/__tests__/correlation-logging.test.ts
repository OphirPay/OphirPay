// SPDX-License-Identifier: MIT
// Unit and integration tests for structured request logging and correlation IDs across API routes (Issue #1303)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractOrGenerateRequestId,
  isValidRequestId,
  withRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";
import { requestIdContext, getCurrentRequestId } from "@/lib/request-id-context";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { buildWebhookRequestPreview, WebhookPayload } from "@/lib/webhook-deliver";

describe("Correlation ID & Request ID Utility Tests (#1303)", () => {
  it("validates request IDs correctly", () => {
    expect(isValidRequestId("req_12345")).toBe(true);
    expect(isValidRequestId("c2847d06-93c4-42b4-82a8-fcf42251bb4c")).toBe(true);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("   ")).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
  });

  it("extracts correlation ID from incoming Headers instance", () => {
    const h = new Headers();
    h.set("x-request-id", "corr-id-abc-123");
    expect(extractOrGenerateRequestId(h)).toBe("corr-id-abc-123");

    const h2 = new Headers();
    h2.set("X-Request-Id", "corr-id-xyz-456");
    expect(extractOrGenerateRequestId(h2)).toBe("corr-id-xyz-456");

    const h3 = new Headers();
    h3.set("x-correlation-id", "corr-custom-789");
    expect(extractOrGenerateRequestId(h3)).toBe("corr-custom-789");
  });

  it("extracts correlation ID from incoming plain object headers", () => {
    expect(extractOrGenerateRequestId({ "x-request-id": "header-val-1" })).toBe("header-val-1");
    expect(extractOrGenerateRequestId({ "X-Request-Id": "header-val-2" })).toBe("header-val-2");
    expect(extractOrGenerateRequestId({ "x-correlation-id": "header-val-3" })).toBe("header-val-3");
  });

  it("generates a fresh UUID when no header is present", () => {
    const id1 = extractOrGenerateRequestId();
    const id2 = extractOrGenerateRequestId(new Headers());
    expect(isValidRequestId(id1)).toBe(true);
    expect(isValidRequestId(id2)).toBe(true);
    expect(id1).not.toBe(id2);
  });

  it("attaches X-Request-Id to response objects using withRequestId", () => {
    const res = new Response(JSON.stringify({ ok: true }));
    withRequestId(res, "test-req-id-999");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("test-req-id-999");
  });
});

describe("Structured Logger Context Correlation (#1303)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("automatically attaches correlation ID to logger calls within an active request scope", () => {
    const correlationId = "corr-test-scope-123";

    requestIdContext.run(correlationId, () => {
      expect(getCurrentRequestId()).toBe(correlationId);

      logger.info("Executing database payment query", { table: "payments" });
      expect(logSpy).toHaveBeenCalled();
      const lastLog = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0]);
      expect(lastLog.context?.requestId).toBe(correlationId);
      expect(lastLog.context?.table).toBe("payments");

      logger.warn("Slow query detected", { durationMs: 250 });
      expect(warnSpy).toHaveBeenCalled();
      const lastWarn = JSON.parse(warnSpy.mock.calls[warnSpy.mock.calls.length - 1][0]);
      expect(lastWarn.context?.requestId).toBe(correlationId);
      expect(lastWarn.context?.durationMs).toBe(250);

      logger.error("Database connection dropped", { code: "ECONNREFUSED" });
      expect(errorSpy).toHaveBeenCalled();
      const lastError = JSON.parse(errorSpy.mock.calls[errorSpy.mock.calls.length - 1][0]);
      expect(lastError.context?.requestId).toBe(correlationId);
      expect(lastError.context?.code).toBe("ECONNREFUSED");
    });
  });

  it("operates normally when called outside of request context without requestId", () => {
    logger.info("Server startup initialization", { version: "1.0.0" });
    expect(logSpy).toHaveBeenCalled();
    const lastLog = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0]);
    expect(lastLog.context?.requestId).toBeUndefined();
    expect(lastLog.context?.version).toBe("1.0.0");
  });
});

describe("Route Handler & Webhook End-to-End Tracing (#1303)", () => {
  it("threads correlation ID from withRequestLogging to response header and logs", async () => {
    const handler = withRequestLogging(async () => {
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    });

    const req = new Request("http://localhost:3000/api/payments", {
      headers: { [REQUEST_ID_HEADER]: "client-req-uuid-777" },
    });

    const res = await handler(req);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("client-req-uuid-777");
  });

  it("passes correlation ID through to webhook payloads and delivery headers", () => {
    const payload: WebhookPayload = {
      event: "payment.succeeded",
      timestamp: "2026-10-18T11:00:00.000Z",
      data: { paymentId: "pay_12345", amount: "100.00" },
    };

    const correlationId = "trace-req-8888-uuid";
    requestIdContext.run(correlationId, () => {
      const preview = buildWebhookRequestPreview(payload, "test_webhook_secret");
      expect(preview.headers["X-Request-Id"]).toBe(correlationId);

      const parsedBody = JSON.parse(preview.body);
      expect(parsedBody.requestId).toBe(correlationId);
      expect(parsedBody.event).toBe("payment.succeeded");
    });
  });
});
