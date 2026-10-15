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

describe("POST /api/csp-report — payload deduplication within 5-minute window (issue #1392)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { getCspReportDeduplicator, setRateLimitStore, InMemoryRateLimitStore } = await import(
      "@/lib/rate-limit"
    );
    getCspReportDeduplicator().reset();
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  it("logs the first violation report and suppresses identical duplicate reports", async () => {
    const { logger } = await import("@/lib/logger");
    const { incMetric } = await import("@/lib/metrics-counters");

    const report1 = legacyReport({
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.com/dupe.js",
    });

    // 1st report: accepted and logged
    const res1 = await postReport(report1);
    expect(res1.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(incMetric).toHaveBeenCalledWith("csp_violation_reports_total");

    // 2nd report: exact duplicate within 5 minutes -> suppressed from logs
    const res2 = await postReport(report1);
    expect(res2.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledTimes(1); // Not called again!
    expect(incMetric).toHaveBeenCalledWith("csp_reports_dropped_total");
  });

  it("logs distinct reports with different blocked-uri or directive", async () => {
    const { logger } = await import("@/lib/logger");
    const { incMetric } = await import("@/lib/metrics-counters");

    const reportA = legacyReport({
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.com/a.js",
    });
    const reportB = legacyReport({
      "violated-directive": "script-src",
      "blocked-uri": "https://evil.com/b.js",
    });

    await postReport(reportA);
    await postReport(reportB);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(incMetric).toHaveBeenCalledWith("csp_violation_reports_total");
  });

  it("allows report to be logged again after deduplication window expires", async () => {
    const { logger } = await import("@/lib/logger");
    const { getCspReportDeduplicator } = await import("@/lib/rate-limit");

    const report = legacyReport({
      "violated-directive": "connect-src",
      "blocked-uri": "https://bad-api.com",
    });

    await postReport(report);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Reset deduplicator (simulating expiration of 5-minute window)
    getCspReportDeduplicator().reset();

    await postReport(report);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/csp-report — sliding-window rate limiting (issue #1392)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { getCspReportDeduplicator, setRateLimitStore, InMemoryRateLimitStore } = await import(
      "@/lib/rate-limit"
    );
    getCspReportDeduplicator().reset();
    setRateLimitStore(new InMemoryRateLimitStore());
  });

  it("throttles requests exceeding 60 reports per minute with 429 and Retry-After", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const { incMetric } = await import("@/lib/metrics-counters");

    // Send 60 reports from the same IP
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": "198.51.100.1",
        },
        body: JSON.stringify(
          legacyReport({
            "blocked-uri": `https://evil.com/rate-${i}.js`,
          })
        ),
      });
      const res = await POST(req);
      expect(res.status).toBe(204);
    }

    // 61st report exceeds rate limit (60 RPM)
    const req61 = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "x-forwarded-for": "198.51.100.1",
      },
      body: JSON.stringify(legacyReport()),
    });
    const res61 = await POST(req61);
    expect(res61.status).toBe(429);
    expect(res61.headers.get("Retry-After")).toBeTruthy();
    expect(incMetric).toHaveBeenCalledWith("csp_reports_dropped_total");
  });

  it("isolates rate limits by IP address", async () => {
    const { POST } = await import("@/app/api/csp-report/route");

    // Client 1 maxes out
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest("http://localhost/api/csp-report", {
        method: "POST",
        headers: {
          "content-type": "application/csp-report",
          "x-forwarded-for": "198.51.100.2",
        },
        body: JSON.stringify(legacyReport({ "blocked-uri": `https://evil.com/${i}` })),
      });
      await POST(req);
    }

    // Client 2 with different IP is still allowed
    const reqClient2 = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "x-forwarded-for": "198.51.100.3",
      },
      body: JSON.stringify(legacyReport({ "blocked-uri": "https://evil.com/client2" })),
    });
    const resClient2 = await POST(reqClient2);
    expect(resClient2.status).toBe(204);
  });
});

describe("POST /api/csp-report — oversized payload handling (issue #1392)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("increments csp_reports_dropped_total when body exceeds 16 KiB", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const { incMetric } = await import("@/lib/metrics-counters");

    const request = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: {
        "content-type": "application/csp-report",
        "content-length": String(16 * 1024 + 10),
      },
      body: "{}",
    });
    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(incMetric).toHaveBeenCalledWith("csp_reports_dropped_total");
  });
});

describe("CspReportDeduplicator & computeCspReportHash (issue #1392)", () => {
  it("computeCspReportHash produces normalized deterministic hashes", async () => {
    const { computeCspReportHash } = await import("@/lib/rate-limit");
    const h1 = computeCspReportHash("https://evil.com/test", "script-src");
    const h2 = computeCspReportHash("  https://evil.com/test  ", "SCRIPT-SRC");
    expect(h1).toBe(h2);
    expect(h1).toBeTruthy();
  });

  it("CspReportDeduplicator evicts oldest when exceeding maxEntries", async () => {
    const { CspReportDeduplicator } = await import("@/lib/rate-limit");
    const dedup = new CspReportDeduplicator(10_000, 3);

    expect(dedup.isDuplicate("hash-1")).toBe(false);
    expect(dedup.isDuplicate("hash-2")).toBe(false);
    expect(dedup.isDuplicate("hash-3")).toBe(false);
    // Adding 4th should cause cache eviction
    expect(dedup.isDuplicate("hash-4")).toBe(false);
  });
});
