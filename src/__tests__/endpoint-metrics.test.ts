// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordEndpointLatency,
  getEndpointMetrics,
  resetEndpointMetrics,
  LATENCY_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";
import { withMetrics } from "@/lib/metrics-middleware";
import { GET } from "@/app/api/metrics/route";

describe("per-endpoint metrics", () => {
  beforeEach(() => {
    resetEndpointMetrics();
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

    const res = await GET();
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
});
