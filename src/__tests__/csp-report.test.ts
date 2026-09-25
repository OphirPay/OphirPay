// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST, OPTIONS, GET } from "@/app/api/csp-report/route";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { buildCsp, proxy } from "@/proxy";
import { logger } from "@/lib/logger";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
  incCspReports,
} from "@/lib/metrics-counters";
import {
  setRateLimitStore,
  InMemoryRateLimitStore,
} from "@/lib/rate-limit";
import { NextRequest } from "next/server";

describe("CSP Violation Reporting & Observability (Issue #698)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMetricsForTest();
    setRateLimitStore(new InMemoryRateLimitStore());
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("buildCsp() and proxy response headers", () => {
    it("omits reporting directives in development mode", () => {
      const csp = buildCsp(false);
      expect(csp).not.toContain("report-uri");
      expect(csp).not.toContain("report-to");
    });

    it("includes report-uri and report-to directives in production mode", () => {
      const csp = buildCsp(true);
      expect(csp).toContain("report-uri /api/csp-report");
      expect(csp).toContain("report-to csp-endpoint");
    });

    it("proxy sets Reporting-Endpoints, Report-To, and reporting CSP on HTML responses in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const req = new NextRequest("http://localhost/dashboard");
      const res = await proxy(req);

      const csp = res.headers.get("Content-Security-Policy");
      expect(csp).toContain("report-uri /api/csp-report");
      expect(csp).toContain("report-to csp-endpoint");

      const reportingEndpoints = res.headers.get("Reporting-Endpoints");
      expect(reportingEndpoints).toBe('csp-endpoint="/api/csp-report"');

      const reportTo = res.headers.get("Report-To");
      expect(reportTo).toBeDefined();
      const parsedReportTo = JSON.parse(reportTo!);
      expect(parsedReportTo.group).toBe("csp-endpoint");
      expect(parsedReportTo.endpoints).toEqual([{ url: "/api/csp-report" }]);
    });

    it("proxy omits Reporting-Endpoints when not in production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const req = new NextRequest("http://localhost/dashboard");
      const res = await proxy(req);

      expect(res.headers.get("Reporting-Endpoints")).toBeNull();
      expect(res.headers.get("Report-To")).toBeNull();
      const csp = res.headers.get("Content-Security-Policy");
      expect(csp).not.toContain("report-uri");
    });
  });

  describe("POST /api/csp-report - Legacy CSP Level 2 format", () => {
    it("accepts application/csp-report, returns 204, redacts query strings, and logs structured warning", async () => {
      const sampleReport = {
        "csp-report": {
          "document-uri": "https://app.ophirpay.com/payments?secret_token=abc12345&user_id=42#step3",
          "referrer": "https://app.ophirpay.com/login?redirect=/payments&session=xyz",
          "violated-directive": "connect-src 'self'",
          "effective-directive": "connect-src",
          "original-policy": "default-src 'self'; connect-src 'self'",
          "disposition": "enforce",
          "blocked-uri": "https://unauthorized-api.stellar.org/v1/tx?bearer=supersecret",
          "status-code": 200,
          "line-number": 12,
          "column-number": 34,
          "source-file": "https://app.ophirpay.com/static/bundle.js?v=999",
        },
      };

      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "cookie": "session_id=attacker_session_cookie; auth_token=secret",
          "x-forwarded-for": "198.51.100.10",
        },
        body: JSON.stringify(sampleReport),
      });

      const res = await POST(req);
      expect(res.status).toBe(204);

      // Verify logger was called
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg, context] = warnSpy.mock.calls[0];
      expect(msg).toBe("CSP violation detected");

      // Verify query parameters, tokens, credentials, and hash fragments were stripped
      expect(context.documentUri).toBe("https://app.ophirpay.com/payments");
      expect(context.documentUri).not.toContain("secret_token");
      expect(context.documentUri).not.toContain("#step3");

      expect(context.referrer).toBe("https://app.ophirpay.com/login");
      expect(context.referrer).not.toContain("session");

      expect(context.blockedUri).toBe("https://unauthorized-api.stellar.org/v1/tx");
      expect(context.blockedUri).not.toContain("bearer");

      expect(context.sourceFile).toBe("https://app.ophirpay.com/static/bundle.js");
      expect(context.sourceFile).not.toContain("v=999");

      // Verify directives and status
      expect(context.violatedDirective).toBe("connect-src 'self'");
      expect(context.effectiveDirective).toBe("connect-src");
      expect(context.disposition).toBe("enforce");
      expect(context.statusCode).toBe(200);
      expect(context.lineNumber).toBe(12);
      expect(context.columnNumber).toBe(34);

      // Verify cookies and headers are not logged anywhere in context
      const contextStr = JSON.stringify(context);
      expect(contextStr).not.toContain("session_id");
      expect(contextStr).not.toContain("attacker_session_cookie");
      expect(contextStr).not.toContain("auth_token");
      expect(contextStr).not.toContain("cookie");

      // Verify metrics counter incremented
      const snapshot = getMetricsSnapshot();
      expect(snapshot.csp_reports_total).toBe(1);
    });
  });

  describe("POST /api/csp-report - Modern Reporting API format (application/reports+json)", () => {
    it("accepts application/reports+json array, processes multiple reports, returns 204", async () => {
      const reportingPayload = [
        {
          type: "csp-violation",
          age: 5,
          url: "https://app.ophirpay.com/settings?auth=token1",
          user_agent: "Mozilla/5.0",
          body: {
            blockedURL: "chrome-extension://abcdefghijklmno/inject.js?foo=bar",
            disposition: "enforce",
            documentURL: "https://app.ophirpay.com/settings?auth=token1",
            effectiveDirective: "script-src-elem",
            originalPolicy: "default-src 'self'",
            referrer: "https://app.ophirpay.com/?token=2",
            sample: "",
            statusCode: 200,
          },
        },
        {
          type: "csp-violation",
          age: 6,
          url: "https://app.ophirpay.com/wallet?key=secret",
          body: {
            blockedURL: "https://malicious-tracker.com/pixel.png?uuid=123",
            disposition: "report",
            effectiveDirective: "img-src",
            statusCode: 200,
          },
        },
      ];

      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/reports+json; charset=utf-8",
          "x-forwarded-for": "198.51.100.11",
        },
        body: JSON.stringify(reportingPayload),
      });

      const res = await POST(req);
      expect(res.status).toBe(204);

      // Verify two violations logged
      expect(warnSpy).toHaveBeenCalledTimes(2);

      const firstCall = warnSpy.mock.calls[0][1];
      expect(firstCall.documentUri).toBe("https://app.ophirpay.com/settings");
      expect(firstCall.blockedUri).toBe("chrome-extension://abcdefghijklmno/inject.js");
      expect(firstCall.effectiveDirective).toBe("script-src-elem");

      const secondCall = warnSpy.mock.calls[1][1];
      expect(secondCall.documentUri).toBe("https://app.ophirpay.com/wallet");
      expect(secondCall.blockedUri).toBe("https://malicious-tracker.com/pixel.png");
      expect(secondCall.effectiveDirective).toBe("img-src");

      // Verify metrics counter incremented by 2
      const snapshot = getMetricsSnapshot();
      expect(snapshot.csp_reports_total).toBe(2);
    });
  });

  describe("Metrics Integration", () => {
    it("reflects report volume in GET /api/metrics endpoint", async () => {
      incCspReports(5);

      const res = await getMetrics();
      expect(res.status).toBe(200);
      const text = await res.text();

      expect(text).toContain("# HELP ophirpay_csp_reports_total Total CSP violation reports received");
      expect(text).toContain("# TYPE ophirpay_csp_reports_total counter");
      expect(text).toContain("ophirpay_csp_reports_total 5");
    });
  });

  describe("Validation & Rejection without logging content", () => {
    it("rejects oversized payloads (413) without logging body content", async () => {
      const hugeString = "a".repeat(20 * 1024); // 20 KB
      const oversizedPayload = JSON.stringify({
        "csp-report": {
          "blocked-uri": "https://example.com/blocked",
          "data": hugeString,
        },
      });

      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "content-length": String(oversizedPayload.length),
        },
        body: oversizedPayload,
      });

      const res = await POST(req);
      expect(res.status).toBe(413);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe("PAYLOAD_TOO_LARGE");

      // Ensure no raw oversized payload was passed to logger.warn
      for (const call of warnSpy.mock.calls) {
        const fullLog = JSON.stringify(call);
        expect(fullLog).not.toContain(hugeString);
      }
    });

    it("rejects malformed JSON (400) without logging body content", async () => {
      const badJson = '{"csp-report": { blocked-uri: invalid_json, secret_token: "leaked"';

      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
        },
        body: badJson,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe("BAD_REQUEST");

      // Verify badJson raw string was NOT logged
      for (const call of warnSpy.mock.calls) {
        const fullLog = JSON.stringify(call);
        expect(fullLog).not.toContain("leaked");
        expect(fullLog).not.toContain(badJson);
      }
    });

    it("rejects empty or non-CSP payloads (400) without logging body content", async () => {
      const nonCspJson = JSON.stringify({ randomField: "some_secret_value" });

      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: nonCspJson,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe("BAD_REQUEST");

      // Verify randomField was NOT logged
      for (const call of warnSpy.mock.calls) {
        const fullLog = JSON.stringify(call);
        expect(fullLog).not.toContain("some_secret_value");
      }
    });

    it("rejects unsupported media types (415)", async () => {
      const req = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
        },
        body: "plain text",
      });

      const res = await POST(req);
      expect(res.status).toBe(415);
      const data = await res.json();
      expect(data.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });
  });

  describe("Rate Limiting", () => {
    it("rate-limits excessive report submissions from the same IP (429)", async () => {
      vi.stubEnv("CSP_REPORT_RATE_LIMIT_RPM", "3");

      const validReport = JSON.stringify({
        "csp-report": {
          "blocked-uri": "https://example.com/blocked.js",
          "violated-directive": "script-src 'self'",
        },
      });

      const ip = "203.0.113.88";

      // 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const req = new Request("http://localhost/api/csp-report", {
          method: "POST",
          headers: {
            "content-type": "application/csp-report",
            "x-forwarded-for": ip,
          },
          body: validReport,
        });
        const res = await POST(req);
        expect(res.status).toBe(204);
      }

      // 4th request should be rate-limited
      const throttledReq = new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": ip,
        },
        body: validReport,
      });

      const throttledRes = await POST(throttledReq);
      expect(throttledRes.status).toBe(429);
      expect(throttledRes.headers.get("Retry-After")).toBeDefined();
      expect(throttledRes.headers.get("X-RateLimit-Remaining")).toBe("0");

      const data = await throttledRes.json();
      expect(data.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("HTTP Method handling", () => {
    it("handles OPTIONS preflight with 204 and CORS headers", async () => {
      const res = await OPTIONS();
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    it("handles GET with 405 Method Not Allowed", async () => {
      const res = await GET();
      expect(res.status).toBe(405);
      const data = await res.json();
      expect(data.error.code).toBe("METHOD_NOT_ALLOWED");
    });
  });
});
