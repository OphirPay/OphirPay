// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recordEndpointLatency,
  getEndpointMetrics,
  resetEndpointMetrics,
  LATENCY_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";
import { withMetrics } from "@/lib/metrics-middleware";
import { GET } from "@/app/api/metrics/route";
import { resetMetricsForTest } from "@/lib/metrics-counters";

// The metrics route falls back to API-key auth, which imports Prisma. These
// tests only exercise the static METRICS_TOKEN path, so stub the module to
// keep the suite free of a database client.
vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

const METRICS_TOKEN = "test-metrics-token-0123456789abcdef";

function authenticatedRequest(token = METRICS_TOKEN): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("per-endpoint metrics", () => {
  beforeEach(() => {
    resetEndpointMetrics();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("produces a metric key for a successful (2xx) request", () => {
    recordEndpointLatency("GET", "/api/payments", 200, 0.01);
    const entries = getEndpointMetrics();
    expect(entries).toHaveLength(1);
    expect(entries[0].method).toBe("GET");
    expect(entries[0].endpoint).toBe("/api/payments");
    expect(entries[0].statusClass).toBe("2xx");
    expect(entries[0].observation.errors).toBe(0);
    expect(entries[0].observation.requests).toBe(1);
  });

  it("produces a metric key for an errored (4xx/5xx) request", () => {
    recordEndpointLatency("POST", "/api/payments", 500, 0.2);
    const entries = getEndpointMetrics();
    expect(entries).toHaveLength(1);
    expect(entries[0].statusClass).toBe("5xx");
    expect(entries[0].observation.errors).toBe(1);
  });

  it("keys metrics by endpoint + status class separately", () => {
    recordEndpointLatency("GET", "/api/payments", 200, 0.01);
    recordEndpointLatency("GET", "/api/payments", 404, 0.05);
    const entries = getEndpointMetrics();
    expect(entries).toHaveLength(2);
    const statusClasses = entries.map((e) => e.statusClass).sort();
    expect(statusClasses).toEqual(["2xx", "4xx"]);
  });

  it("accumulates histogram buckets cumulatively", () => {
    recordEndpointLatency("GET", "/api/x", 200, 0.001);
    const entry = getEndpointMetrics()[0].observation;
    // 0.001s is below the smallest bound, so every finite bucket and the
    // +Inf bucket must contain the single observation (histograms are
    // cumulative).
    for (const b of entry.buckets) expect(b).toBe(1);
    expect(entry.latencyCount).toBe(1);
    expect(entry.latencySum).toBeCloseTo(0.001, 6);
  });

  it("places observations in the correct cumulative bucket", () => {
    recordEndpointLatency("GET", "/api/y", 200, 0.3);
    const entry = getEndpointMetrics()[0].observation;
    // 0.3s falls between the 0.25 and 0.5 bounds.
    const twoFive = LATENCY_BUCKET_BOUNDS.indexOf(0.25);
    const five = LATENCY_BUCKET_BOUNDS.indexOf(0.5);
    expect(entry.buckets[twoFive]).toBe(0);
    expect(entry.buckets[five]).toBe(1);
    // Buckets above 0.3 (>=0.5) stay empty; +Inf stays 1.
    expect(entry.buckets[LATENCY_BUCKET_BOUNDS.length]).toBe(1);
  });

  it("withMetrics records a 2xx observation for a successful handler", async () => {
    const handler = withMetrics("GET /api/wrapped", async () => {
      return new Response("ok", { status: 200 });
    });
    await handler();
    const entry = getEndpointMetrics()[0];
    expect(entry.statusClass).toBe("2xx");
    expect(entry.observation.errors).toBe(0);
  });

  it("withMetrics records a 5xx observation when handler throws", async () => {
    const handler = withMetrics("GET /api/wrapped", async () => {
      throw new Error("boom");
    });
    await expect(handler()).rejects.toThrow("boom");
    const entry = getEndpointMetrics()[0];
    expect(entry.statusClass).toBe("5xx");
    expect(entry.observation.errors).toBe(1);
  });

  it("exposes endpoint metrics on the /api/metrics endpoint", async () => {
    recordEndpointLatency("GET", "/api/payments", 200, 0.01);
    recordEndpointLatency("POST", "/api/payments", 500, 0.2);

    const res = await GET(authenticatedRequest());
    const text = await res.text();

    expect(text).toContain(
      'ophirpay_endpoint_request_duration_seconds_bucket{method="GET",endpoint="/api/payments",status_class="2xx"'
    );
    expect(text).toContain(
      'ophirpay_endpoint_request_duration_seconds_count{method="GET",endpoint="/api/payments",status_class="2xx"} 1'
    );
    expect(text).toContain(
      'ophirpay_endpoint_errors_total{method="POST",endpoint="/api/payments",status_class="5xx"} 1'
    );
    expect(text).toContain("# TYPE ophirpay_endpoint_errors_total counter");
  });

  it("matches the Prometheus exposition format golden file", async () => {
    resetMetricsForTest();
    recordEndpointLatency("GET", "/api/payments", 200, 0.05);
    recordEndpointLatency("GET", "/api/payments", 200, 0.3);
    recordEndpointLatency("POST", '/api/escape/"\\', 500, 1.2);

    const res = await GET(authenticatedRequest());
    const text = await res.text();
    
    // Ignore dynamic parts like memory info
    const staticText = text
      .replace(/ophirpay_process_resident_set_bytes \d+/g, 'ophirpay_process_resident_set_bytes 0')
      .replace(/ophirpay_process_heap_used_bytes \d+/g, 'ophirpay_process_heap_used_bytes 0')
      .replace(/ophirpay_process_heap_total_bytes \d+/g, 'ophirpay_process_heap_total_bytes 0');

    await expect(staticText).toMatchFileSnapshot("__snapshots__/prometheus-exposition.golden.txt");
  });

  it("produces valid structural formatting (TYPE lines and cumulative buckets)", async () => {
    resetMetricsForTest();
    recordEndpointLatency("GET", "/api/payments", 200, 0.05);
    recordEndpointLatency("GET", "/api/payments", 200, 0.3);
    recordEndpointLatency("POST", '/api/escape/"\\', 500, 1.2);

    const res = await GET(authenticatedRequest());
    const text = await res.text();
    const lines = text.split("\n");

    const metricFamilies = new Set<string>();
    const typeLines = new Set<string>();
    
    let previousBucketVal = 0;
    let currentBucketName = "";

    for (const line of lines) {
      if (!line || line.startsWith("# HELP") || line.startsWith("# TYPE")) {
        if (line.startsWith("# TYPE")) {
          const parts = line.split(" ");
          typeLines.add(parts[2]);
        }
        continue;
      }
      
      const name = line.split("{")[0].split(" ")[0];
      const familyName = name.replace(/_bucket$|_sum$|_count$/, "");
      metricFamilies.add(familyName);

      if (name.endsWith("_bucket")) {
        const val = Number(line.split(" ").pop());
        const bucketBaseName = line.split(",le=")[0];
        if (bucketBaseName !== currentBucketName) {
           previousBucketVal = 0;
           currentBucketName = bucketBaseName;
        }
        expect(val).toBeGreaterThanOrEqual(previousBucketVal);
        previousBucketVal = val;
        
        if (line.includes('le="+Inf"')) {
          currentBucketName = ""; // reset for next histogram
        }
      }
    }

    // Every family should have a matching TYPE line
    for (const family of metricFamilies) {
      expect(typeLines.has(family)).toBe(true);
    }
  });
});

describe("GET /api/metrics authentication (#699)", () => {
  beforeEach(() => {
    resetEndpointMetrics();
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("returns 401 with no metric body when no credential is presented", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const res = await GET(new Request("http://localhost/api/metrics"));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("ophirpay_http_requests_total");
    expect(text).not.toContain("ophirpay_process_resident_set_bytes");
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("returns 401 when the bearer token is wrong", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const res = await GET(authenticatedRequest("not-the-right-token"));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("ophirpay_info");
  });

  it("fails closed when METRICS_TOKEN is unset", async () => {
    delete process.env.METRICS_TOKEN;
    const res = await GET(authenticatedRequest());
    expect(res.status).toBe(401);
  });

  it("returns the unchanged exposition format for a valid bearer token", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const res = await GET(authenticatedRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("ophirpay_http_requests_total");
    expect(text).toContain("ophirpay_info");
  });

  it("accepts a lowercase bearer scheme", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const res = await GET(
      new Request("http://localhost/api/metrics", {
        headers: { authorization: `bearer ${METRICS_TOKEN}` },
      })
    );
    expect(res.status).toBe(200);
  });
});
