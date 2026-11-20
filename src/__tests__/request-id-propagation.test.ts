// SPDX-License-Identifier: MIT

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  conflictError,
  errorResponse,
  logApiError,
  rateLimitError,
  successResponse,
} from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { requestIdContext } from "@/lib/request-logging";
import { proxy } from "@/proxy";

describe("X-Request-ID propagation across all API responses (Issue #1951)", () => {
  describe("Edge Proxy (proxy.ts)", () => {
    it("preserves an existing incoming X-Request-ID header", async () => {
      const customId = "custom-client-uuid-12345";
      const req = new NextRequest("http://localhost/api/health", {
        headers: {
          "X-Request-ID": customId,
        },
      });

      const res = await proxy(req);
      expect(res.headers.get("X-Request-Id")).toBe(customId);
      expect(res.headers.get("x-request-id")).toBe(customId);
    });

    it("generates a new unique request ID if X-Request-ID is not provided", async () => {
      const req = new NextRequest("http://localhost/api/health");
      const res = await proxy(req);

      const generated = res.headers.get("X-Request-Id");
      expect(generated).toBeTruthy();
      expect(typeof generated).toBe("string");
      expect(generated!.length).toBeGreaterThan(0);
    });

    it("attaches X-Request-Id header to CORS preflight responses", async () => {
      const req = new NextRequest("http://localhost/api/payments", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "X-Request-ID": "preflight-req-id-789",
        },
      });

      const res = await proxy(req);
      expect(res.headers.get("X-Request-Id")).toBe("preflight-req-id-789");
    });
  });

  describe("API Response Helpers (api-response.ts)", () => {
    it("stamps X-Request-Id on successResponse when request context is present", async () => {
      await requestIdContext.run("context-req-id-1", async () => {
        const res = successResponse({ ok: true });
        expect(res.headers.get("X-Request-Id")).toBe("context-req-id-1");
      });
    });

    it("stamps X-Request-Id on errorResponse when request context is present", async () => {
      await requestIdContext.run("context-req-id-2", async () => {
        const res = errorResponse("BAD_REQUEST", "Bad request");
        expect(res.headers.get("X-Request-Id")).toBe("context-req-id-2");
      });
    });

    it("stamps X-Request-Id on rateLimitError when request context is present", async () => {
      await requestIdContext.run("context-req-id-3", async () => {
        const res = rateLimitError("Rate limit exceeded", 30);
        expect(res.headers.get("X-Request-Id")).toBe("context-req-id-3");
      });
    });

    it("stamps X-Request-Id on conflictError when request context is present", async () => {
      await requestIdContext.run("context-req-id-4", async () => {
        const res = conflictError("Concurrent conflict");
        expect(res.headers.get("X-Request-Id")).toBe("context-req-id-4");
      });
    });
  });

  describe("Error stack traces and log context", () => {
    it("correlates requestId with error message and stack trace in logApiError", async () => {
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      await requestIdContext.run("error-trace-req-id-99", async () => {
        const testError = new Error("Something went wrong on the server");
        logApiError(testError, "TestContext");

        expect(errorSpy).toHaveBeenCalledWith(
          "TestContext",
          expect.objectContaining({
            requestId: "error-trace-req-id-99",
            error: "Something went wrong on the server",
            stack: expect.stringContaining("Something went wrong on the server"),
          })
        );
      });

      errorSpy.mockRestore();
    });
  });
});
