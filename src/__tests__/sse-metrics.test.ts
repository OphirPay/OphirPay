// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  incSseActiveConnection,
  decSseActiveConnection,
  incSseActiveConnections,
  getSseActiveConnectionsSnapshot,
  observeSseConnectionDuration,
  getSseDurationMetrics,
  resetSseMetrics,
  resetMetricsForTest,
  SSE_DURATION_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getAuditLogSse } from "@/app/api/audit-log/sse/route";
import fs from "node:fs";
import path from "node:path";

// Mock external dependencies that touch network or contracts
vi.mock("@/lib/events/event-source", () => ({
  createLiveEventSource: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/lib/stellar", () => ({
  getSorobanServer: () => ({
    getAccount: vi.fn(async () => ({})),
    simulateTransaction: vi.fn(async () => ({ result: { retval: 0 } })),
  }),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
  withApiAuth: (handler: any) => handler,
}));

const METRICS_TOKEN = "test-token-sse-metrics";

function authedMetricsRequest(): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
}

describe("SSE Prometheus Metrics & Disconnect Telemetry (#1425)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
    resetMetricsForTest();
  });

  describe("metrics-counters SSE unit logic", () => {
    it("increments and decrements active connections per route independently", () => {
      expect(getSseActiveConnectionsSnapshot()).toEqual({});

      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/audit-log/sse");

      expect(getSseActiveConnectionsSnapshot()).toEqual({
        "/api/events": 2,
        "/api/audit-log/sse": 1,
      });

      decSseActiveConnection("/api/events");
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(1);

      decSseActiveConnection("/api/events");
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);

      decSseActiveConnection("/api/audit-log/sse");
      expect(getSseActiveConnectionsSnapshot()["/api/audit-log/sse"]).toBe(0);
    });

    it("clamps active connection counts at zero to prevent negative leaks", () => {
      decSseActiveConnection("/api/events");
      decSseActiveConnection("/api/events");
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);

      incSseActiveConnections("/api/events", -5);
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);
    });

    it("records connection duration observations in appropriate histogram buckets", () => {
      observeSseConnectionDuration("/api/events", 2.5); // falls in <= 5, <= 15, ..., +Inf
      observeSseConnectionDuration("/api/events", 45.0); // falls in <= 60, ..., +Inf
      observeSseConnectionDuration("/api/audit-log/sse", 0.5); // falls in <= 1, <= 5, ..., +Inf

      const entries = getSseDurationMetrics();
      expect(entries).toHaveLength(2);

      const eventsMetric = entries.find((e) => e.route === "/api/events")!;
      expect(eventsMetric).toBeDefined();
      expect(eventsMetric.observation.count).toBe(2);
      expect(eventsMetric.observation.sum).toBeCloseTo(47.5);

      // Check +Inf bucket counts all
      const infBucketIndex = SSE_DURATION_BUCKET_BOUNDS.length;
      expect(eventsMetric.observation.buckets[infBucketIndex]).toBe(2);

      // 2.5s is not <= 1s, but <= 5s
      const bucket1Index = SSE_DURATION_BUCKET_BOUNDS.indexOf(1);
      const bucket5Index = SSE_DURATION_BUCKET_BOUNDS.indexOf(5);
      const bucket60Index = SSE_DURATION_BUCKET_BOUNDS.indexOf(60);

      expect(eventsMetric.observation.buckets[bucket1Index]).toBe(0);
      expect(eventsMetric.observation.buckets[bucket5Index]).toBe(1);
      expect(eventsMetric.observation.buckets[bucket60Index]).toBe(2);

      const auditMetric = entries.find((e) => e.route === "/api/audit-log/sse")!;
      expect(auditMetric.observation.count).toBe(1);
      expect(auditMetric.observation.sum).toBeCloseTo(0.5);
      expect(auditMetric.observation.buckets[bucket1Index]).toBe(1);
    });

    it("resets SSE metrics properly", () => {
      incSseActiveConnection("/api/events");
      observeSseConnectionDuration("/api/events", 10);
      resetSseMetrics();

      expect(getSseActiveConnectionsSnapshot()).toEqual({});
      expect(getSseDurationMetrics()).toEqual([]);
    });
  });

  describe("GET /api/events connection lifecycle & telemetry", () => {
    it("increments gauge on connect and decrements on stream cancellation", async () => {
      const res = await getEvents(new Request("http://localhost/api/events"));
      expect(res.status).toBe(200);
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(1);

      if (res.body) {
        await res.body.cancel();
      }

      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);
      const durations = getSseDurationMetrics();
      expect(durations.find((e) => e.route === "/api/events")?.observation.count).toBe(1);
    });

    it("decrements gauge cleanly on client abort signal (unclean disconnect)", async () => {
      const controller = new AbortController();
      const req = new Request("http://localhost/api/events", {
        signal: controller.signal,
      });

      const res = await getEvents(req);
      expect(res.status).toBe(200);
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(1);

      // Simulate client abrupt abort (e.g., closing tab or network drop)
      controller.abort();

      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);
    });
  });

  describe("GET /api/audit-log/sse connection lifecycle & telemetry", () => {
    it("increments gauge on connect and decrements on stream cancellation", async () => {
      const res = await getAuditLogSse(new Request("http://localhost/api/audit-log/sse"));
      expect(res.status).toBe(200);
      expect(getSseActiveConnectionsSnapshot()["/api/audit-log/sse"]).toBe(1);

      if (res.body) {
        await res.body.cancel();
      }

      expect(getSseActiveConnectionsSnapshot()["/api/audit-log/sse"]).toBe(0);
      const durations = getSseDurationMetrics();
      expect(durations.find((e) => e.route === "/api/audit-log/sse")?.observation.count).toBe(1);
    });

    it("decrements gauge cleanly on client abort signal without count leakage", async () => {
      const controller = new AbortController();
      const req = new Request("http://localhost/api/audit-log/sse", {
        signal: controller.signal,
      });

      const res = await getAuditLogSse(req);
      expect(res.status).toBe(200);
      expect(getSseActiveConnectionsSnapshot()["/api/audit-log/sse"]).toBe(1);

      // Abort connection
      controller.abort();

      expect(getSseActiveConnectionsSnapshot()["/api/audit-log/sse"]).toBe(0);
    });
  });

  describe("Exposition on /api/metrics", () => {
    it("exposes real-time active connections and duration histogram on /api/metrics", async () => {
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/audit-log/sse");
      observeSseConnectionDuration("/api/events", 12.5);

      const res = await getMetrics(authedMetricsRequest());
      expect(res.status).toBe(200);
      const text = await res.text();

      expect(text).toContain("# HELP ophirpay_sse_active_connections Currently active SSE client connections per route");
      expect(text).toContain("# TYPE ophirpay_sse_active_connections gauge");
      expect(text).toContain('ophirpay_sse_active_connections{route="/api/events"} 2');
      expect(text).toContain('ophirpay_sse_active_connections{route="/api/audit-log/sse"} 1');

      expect(text).toContain("# HELP ophirpay_sse_connection_duration_seconds Client SSE connection longevity in seconds");
      expect(text).toContain("# TYPE ophirpay_sse_connection_duration_seconds histogram");
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_bucket{route="/api/events",le="15"} 1');
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_count{route="/api/events"} 1');
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_sum{route="/api/events"} 12.5');
    });
  });

  describe("Grafana Dashboard configuration (#1425)", () => {
    it("contains the active SSE connections panel with expected target query", () => {
      const dashboardPath = path.resolve(process.cwd(), "monitoring/grafana-dashboard.json");
      const content = fs.readFileSync(dashboardPath, "utf-8");
      const json = JSON.parse(content);

      const ssePanel = json.panels.find((p: any) => p.title === "Active SSE Connections");
      expect(ssePanel).toBeDefined();
      expect(ssePanel.type).toBe("timeseries");

      const target = ssePanel.targets.find(
        (t: any) => t.expr === "ophirpay_sse_active_connections"
      );
      expect(target).toBeDefined();
      expect(target.legendFormat).toBe("{{route}}");
    });
  });
});
