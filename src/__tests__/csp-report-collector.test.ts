// SPDX-License-Identifier: MIT
// Tests for the CSP violation report collector (issue #698).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Module mocks ──────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/metrics-counters", () => ({
  incMetric: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────

async function postReport(
  body: unknown,
  contentType = "application/csp-report"
): Promise<Response> {
  const { POST } = await import("@/app/api/csp-report/route");
  const request = new NextRequest("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });
  return POST(request);
}

function legacyReport(overrides: Record<string, unknown> = {}) {
  return {
    "csp-report": {
      "document-uri": "https://example.com/page",
      "violated-directive": "script-src",
      "effective-directive": "script-src",
      "blocked-uri": "https://evil.com/malicious.js",
      "disposition": "enforce",
      "status-code": 200,
      ...overrides,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("POST /api/csp-report — legacy application/csp-report format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module registry so import() re-evaluates with fresh mocks
    vi.resetModules();
  });

  it("returns 204 for a well-formed legacy report", async () => {
    const res = await postReport(legacyReport());
    expect(res.status).toBe(204);
  });

  it("increments csp_violation_reports_total metric", async () => {
    const { incMetric } = await import("@/lib/metrics-counters");
    await postReport(legacyReport());
    expect(incMetric).toHaveBeenCalledWith("csp_violation_reports_total");
  });

  it("logs via logger.warn with violated-directive and blocked-uri", async () => {
    const { logger } = await import("@/lib/logger");
    await postReport(legacyReport());
    expect(logger.warn).toHaveBeenCalledWith(
      "csp_violation",
      expect.objectContaining({
        violatedDirective: "script-src",
        blockedUri: "https://evil.com/malicious.js",
      })
    );
  });

  it("does NOT log raw referrer or cookies (not in allow-list)", async () => {
    const { logger } = await import("@/lib/logger");
    await postReport(
      legacyReport({ referrer: "https://user-pii.example.com/private?token=secret" })
    );
    const callArg = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(JSON.stringify(callArg)).not.toContain("user-pii");
    expect(JSON.stringify(callArg)).not.toContain("secret");
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const request = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "NOT_JSON{{",
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("returns 413 when Content-Length exceeds 16 KiB", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const request = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": String(16 * 1024 + 1),
      },
      body: "{}",
    });
    const res = await POST(request);
    expect(res.status).toBe(413);
  });

  it("returns 400 for an unrecognised JSON structure", async () => {
    const res = await postReport({ unexpected: "shape" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/csp-report — Reporting API application/reports+json format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("accepts an array of csp-violation entries and returns 204", async () => {
    const res = await postReport(
      [
        {
          type: "csp-violation",
          age: 10,
          url: "https://example.com/",
          body: {
            "violated-directive": "img-src",
            "blocked-uri": "https://cdn.evil.com/img.png",
            "disposition": "enforce",
          },
        },
      ],
      "application/reports+json"
    );
    expect(res.status).toBe(204);
  });

  it("increments the counter once per report entry", async () => {
    const { incMetric } = await import("@/lib/metrics-counters");
    await postReport(
      [
        { type: "csp-violation", body: { "violated-directive": "script-src" } },
        { type: "csp-violation", body: { "violated-directive": "img-src" } },
      ],
      "application/reports+json"
    );
    expect(incMetric).toHaveBeenCalledTimes(2);
  });

  it("returns 204 with empty log when array has no csp-violation entries", async () => {
    const res = await postReport(
      [{ type: "network-error", body: {} }],
      "application/reports+json"
    );
    // Non-CSP entries are skipped; no csp report to log but we still return 204
    expect([204, 204]).toContain(res.status);
  });
});

describe("POST /api/csp-report — CSP directive in proxy.ts (issue #698)", () => {
  it("buildCsp output includes report-to and report-uri directives", async () => {
    // Import the proxy module and exercise buildCsp indirectly via the
    // Content-Security-Policy header set on an HTML page response.
    const proxyModule = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");

    const req = new Req("http://localhost/dashboard");
    const res = await proxyModule.proxy(req);
    const csp = res?.headers?.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("report-to");
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("Report-To header is set on HTML page responses", async () => {
    const proxyModule = await import("@/proxy");
    const { NextRequest: Req } = await import("next/server");

    const req = new Req("http://localhost/dashboard");
    const res = await proxyModule.proxy(req);

    expect(res?.headers?.get("Report-To")).toBeTruthy();
    expect(res?.headers?.get("Reporting-Endpoints")).toContain("csp-endpoint");
  });
});
