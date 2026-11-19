// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { isSafeWebhookUrlAtDeliveryMock } = vi.hoisted(() => ({
  isSafeWebhookUrlAtDeliveryMock: vi.fn(),
}));

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: isSafeWebhookUrlAtDeliveryMock,
}));

import proxy from "@/proxy";
import { logger } from "@/lib/logger";
import {
  getCurrentRequestId,
  requestIdContext,
  withRequestLogging,
} from "@/lib/request-logging";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { deliverWebhook } from "@/lib/webhook-deliver";

/**
 * Issue: API logs lacked consistent correlation IDs. These tests pin the
 * end-to-end contract: the proxy stamps every API response, logger calls made
 * during a request inherit the same id, and webhook deliveries carry the
 * originating request id in both the signed body and request headers.
 */
describe("request correlation", () => {
  beforeEach(() => {
    isSafeWebhookUrlAtDeliveryMock.mockReset();
    isSafeWebhookUrlAtDeliveryMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds X-Request-Id to every API response, including CORS preflight", async () => {
    const getResponse = await proxy(
      new NextRequest("https://example.com/api/payments", { method: "GET" })
    );
    expect(getResponse.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);

    const optionsResponse = await proxy(
      new NextRequest("https://example.com/api/payments", {
        method: "OPTIONS",
        headers: { origin: "https://app.example.com" },
      })
    );
    expect(optionsResponse.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/);
  });

  it("returns the same id in the response header and request log", async () => {
    const requestSpy = vi
      .spyOn(logger, "request")
      .mockImplementation(() => {});
    const handler = withRequestLogging(async () => new Response("ok"));

    const response = await handler(
      new Request("https://example.com/api/payments", { method: "GET" })
    );

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toBeTruthy();
    expect(requestSpy.mock.calls[0][4]).toBe(requestId);
  });

  it("attaches the active request id to every logger entry automatically", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await requestIdContext.run("req_correlation_1", async () => {
      logger.info("first");
      logger.warn("second");
      expect(getCurrentRequestId()).toBe("req_correlation_1");
    });

    // console.warn is used for the warn-level entry.
    const entries = [...logSpy.mock.calls, ...warnSpy.mock.calls].map((call) =>
      JSON.parse(call[0] as string)
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.requestId).toBe("req_correlation_1");
    }
  });

  it("does not invent a request id outside a request context", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("background job");

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry).not.toHaveProperty("requestId");
  });

  it("includes the originating request id in webhook payloads and headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await deliverWebhook(
      "https://example.com/hook",
      "test-secret-0123456789",
      {
        event: "payment.created",
        timestamp: "2026-08-14T00:00:00Z",
        data: { id: "p_123" },
        requestId: "req_webhook_1",
      },
      1
    );

    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.requestId).toBe("req_webhook_1");
    const headers = init.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe(body.requestId);
  });

  it("inherits the id from the request context for dispatched webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await requestIdContext.run("req_dispatch_42", async () => {
      await deliverWebhook(
        "https://example.com/hook",
        "test-secret-0123456789",
        {
          event: "payment.created",
          timestamp: "2026-08-14T00:00:00Z",
          data: { id: "p_456" },
        },
        1
      );
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.requestId).toBe("req_dispatch_42");
    expect((init.headers as Record<string, string>)[REQUEST_ID_HEADER]).toBe(
      "req_dispatch_42"
    );
  });

  it("prefers an explicit stored request id over the current context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await requestIdContext.run("req_current", async () => {
      await deliverWebhook(
        "https://example.com/hook",
        "test-secret-0123456789",
        {
          event: "payment.created",
          timestamp: "2026-08-14T00:00:00Z",
          data: { id: "p_789" },
          requestId: "req_original",
        },
        1
      );
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.requestId).toBe("req_original");
  });
});
