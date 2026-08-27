// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  withRequestLogging,
  getCurrentRequestId,
  requestIdContext,
} from "@/lib/request-logging";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { logger } from "@/lib/logger";
import { handleApiError } from "@/lib/api-response";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRequestLogging", () => {

  it("logs request id, method, path, status, and duration", async () => {
    const spy = vi.spyOn(logger, "request").mockImplementation(() => {});
    const handler = withRequestLogging(async () =>
      new Response("ok", { status: 201 })
    );

    const response = await handler(
      new Request("https://example.com/api/payments?page=2", { method: "POST" })
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [method, path, status, durationMs, requestId] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/payments");
    expect(status).toBe(201);
    expect(typeof durationMs).toBe("number");
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof requestId).toBe("string");
    expect(requestId?.length ?? 0).toBeGreaterThan(0);
    // The logged id must be the one returned on the response
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  it("records the actual duration of the handler", async () => {
    const spy = vi.spyOn(logger, "request").mockImplementation(() => {});
    const handler = withRequestLogging(async () => {
      // 50ms gives the assertion below a comfortable margin so the test is not
      // flaky when the suite runs with many parallel workers (10ms was racy).
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response("ok");
    });

    await handler(new Request("https://example.com/api/slow"));

    const durationMs = spy.mock.calls[0][3] as number;
    expect(durationMs).toBeGreaterThanOrEqual(10);
  });

  it("reuses an incoming X-Request-Id header", async () => {
    const spy = vi.spyOn(logger, "request").mockImplementation(() => {});
    const handler = withRequestLogging(async () => new Response("ok"));

    const request = new Request("https://example.com/api/x", {
      headers: { [REQUEST_ID_HEADER]: "req_abc_123" },
    });
    const response = await handler(request);

    expect(spy.mock.calls[0][4]).toBe("req_abc_123");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("req_abc_123");
  });

  it("preserves the original response and only sets the request id header", async () => {
    const handler = withRequestLogging(async () =>
      new Response("ok", {
        status: 404,
        headers: { "Content-Type": "application/json", "X-Custom": "v" },
      })
    );

    const response = await handler(new Request("https://example.com/api/x"));

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Custom")).toBe("v");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("passes the second argument through for dynamic routes", async () => {
    const inner = vi.fn(async (_request: Request, { params }: { params: { id: string } }) =>
      new Response(`payment ${params.id}`)
    );
    const handler = withRequestLogging(inner);

    const response = await handler(
      new Request("https://example.com/api/payments/42"),
      { params: { id: "42" } }
    );

    expect(inner).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("payment 42");
  });

  it("logs unhandled errors with the request id and re-throws", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const handler = withRequestLogging(async () => {
      throw new Error("boom");
    });

    await expect(
      handler(new Request("https://example.com/api/x", { method: "DELETE" }))
    ).rejects.toThrow("boom");

    expect(spy).toHaveBeenCalledTimes(1);
    const [message, context] = spy.mock.calls[0];
    expect(message).toBe("Unhandled API route error");
    expect(context).toMatchObject({
      requestId: expect.any(String),
      method: "DELETE",
      path: "/api/x",
      status: 500,
      durationMs: expect.any(Number),
      error: "boom",
    });
  });

  it("makes the request id available to the handler via async context", async () => {
    let observed: string | undefined;
    const handler = withRequestLogging(async () => {
      observed = getCurrentRequestId();
      return new Response("ok");
    });

    await handler(new Request("https://example.com/api/x"));

    expect(typeof observed).toBe("string");
    expect(observed?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("logger.request", () => {
  it("emits requestId in the structured log line when provided", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.request("GET", "/api/payments", 200, 12.5, "req_xyz");

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.level).toBe("info");
    expect(line.message).toBe("GET /api/payments 200");
    expect(line.context).toMatchObject({
      method: "GET",
      path: "/api/payments",
      status: 200,
      durationMs: 12.5,
      requestId: "req_xyz",
    });
  });

  it("omits requestId when not provided", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.request("GET", "/api/payments", 200, 3);

    const line = JSON.parse(spy.mock.calls[0][0]);
    expect(line.context).not.toHaveProperty("requestId");
  });
});

describe("request id in error logs", () => {

  it("threads the current request id into handleApiError logs", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    await requestIdContext.run("req_ctx_1", async () => {
      handleApiError(new Error("db down"), "POST /api/x");
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "POST /api/x",
      expect.objectContaining({ requestId: "req_ctx_1" })
    );
  });

  it("logs without requestId outside a request context", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    handleApiError(new Error("db down"), "POST /api/x");

    const context = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(context.requestId).toBeUndefined();
  });
});
