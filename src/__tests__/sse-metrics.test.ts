// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
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
import { GET as metricsGet } from "@/app/api/metrics/route";
import { GET as eventsGet } from "@/app/api/events/route";
import { GET as auditSseGet } from "@/app/api/audit-log/sse/route";

function authenticatedRequest(headers: Record<string, string> = {}): Request {
  const token = "test-metrics-token-123456";
  process.env.METRICS_TOKEN = token;
  return new Request("http://localhost:3000/api/metrics", {
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
}

describe("SSE Metrics & Telemetry (#1425)", () => {
  beforeEach(() => {
    resetMetricsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Active SSE Connections Gauge", () => {
    it("increments and decrements active connections per route", () => {
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/audit-log/sse");

      let snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/events"]).toBe(2);
      expect(snapshot["/api/audit-log/sse"]).toBe(1);

      decSseActiveConnection("/api/events");
      snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/events"]).toBe(1);

      decSseActiveConnection("/api/events");
      snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/events"]).toBe(0);
    });

    it("clamps active connections at zero to prevent underflow leaks", () => {
      decSseActiveConnection("/api/events");
      decSseActiveConnection("/api/events");
      const snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/events"]).toBe(0);

      incSseActiveConnections("/api/events", -5);
      expect(getSseActiveConnectionsSnapshot()["/api/events"]).toBe(0);
    });

    it("resets SSE metrics properly", () => {
      incSseActiveConnection("/api/events");
      observeSseConnectionDuration("/api/events", 10);
      resetSseMetrics();

      expect(getSseActiveConnectionsSnapshot()).toEqual({});
      expect(getSseDurationMetrics()).toEqual([]);
    });
  });

  describe("SSE Connection Duration Histogram", () => {
    it("records durations into proper histogram buckets and calculates sum/count", () => {
      observeSseConnectionDuration("/api/events", 0.5); // <= 1
      observeSseConnectionDuration("/api/events", 4.2); // <= 5
      observeSseConnectionDuration("/api/events", 45);  // <= 60

      const entries = getSseDurationMetrics();
      const eventsEntry = entries.find((e) => e.route === "/api/events");
      expect(eventsEntry).toBeDefined();

      const obs = eventsEntry!.observation;
      expect(obs.count).toBe(3);
      expect(obs.sum).toBeCloseTo(49.7, 5);

      // Bucket <= 1s should have 1 item
      const idx1 = SSE_DURATION_BUCKET_BOUNDS.indexOf(1);
      expect(obs.buckets[idx1]).toBe(1);

      // Bucket <= 5s should have 2 items (0.5 and 4.2)
      const idx5 = SSE_DURATION_BUCKET_BOUNDS.indexOf(5);
      expect(obs.buckets[idx5]).toBe(2);

      // Bucket <= 60s should have 3 items
      const idx60 = SSE_DURATION_BUCKET_BOUNDS.indexOf(60);
      expect(obs.buckets[idx60]).toBe(3);

      // +Inf bucket must contain all 3
      expect(obs.buckets[SSE_DURATION_BUCKET_BOUNDS.length]).toBe(3);
    });

    it("handles zero and negative durations gracefully by clamping to 0", () => {
      observeSseConnectionDuration("/api/audit-log/sse", -5);
      const entries = getSseDurationMetrics();
      const auditEntry = entries.find((e) => e.route === "/api/audit-log/sse");
      expect(auditEntry).toBeDefined();
      expect(auditEntry!.observation.sum).toBe(0);
      expect(auditEntry!.observation.count).toBe(1);
      expect(auditEntry!.observation.buckets[0]).toBe(1);
    });
  });

  describe("Prometheus Metrics Exposition (/api/metrics)", () => {
    it("exposes ophirpay_sse_active_connections gauge with route labels", async () => {
      incSseActiveConnection("/api/events");
      incSseActiveConnection("/api/audit-log/sse");

      const res = await metricsGet(authenticatedRequest());
      const text = await res.text();

      expect(text).toContain("# HELP ophirpay_sse_active_connections Currently active SSE client connections per route");
      expect(text).toContain("# TYPE ophirpay_sse_active_connections gauge");
      expect(text).toContain('ophirpay_sse_active_connections{route="/api/events"} 1');
      expect(text).toContain('ophirpay_sse_active_connections{route="/api/audit-log/sse"} 1');
    });

    it("exposes ophirpay_sse_connection_duration_seconds histogram when observations exist", async () => {
      observeSseConnectionDuration("/api/events", 12);

      const res = await metricsGet(authenticatedRequest());
      const text = await res.text();

      expect(text).toContain("# HELP ophirpay_sse_connection_duration_seconds Client SSE connection longevity in seconds");
      expect(text).toContain("# TYPE ophirpay_sse_connection_duration_seconds histogram");
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_bucket{route="/api/events",le="15"} 1');
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_bucket{route="/api/events",le="+Inf"} 1');
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_sum{route="/api/events"} 12');
      expect(text).toContain('ophirpay_sse_connection_duration_seconds_count{route="/api/events"} 1');
    });
  });

  describe("Route Lifecycle & Abort Telemetry", () => {
    it("handles /api/events client abort gracefully without metric count leaks", async () => {
      const controller = new AbortController();
      const request = new Request("http://localhost:3000/api/events", {
        signal: controller.signal,
      });

      const res = await eventsGet(request);
      expect(res.status).toBe(200);

      const snapshotBefore = getSseActiveConnectionsSnapshot();
      expect(snapshotBefore["/api/events"]).toBe(1);

      // Abort connection
      controller.abort();

      const snapshotAfter = getSseActiveConnectionsSnapshot();
      expect(snapshotAfter["/api/events"]).toBe(0);

      // Duration should have been recorded
      const durations = getSseDurationMetrics();
      const eventDuration = durations.find((d) => d.route === "/api/events");
      expect(eventDuration).toBeDefined();
      expect(eventDuration!.observation.count).toBe(1);
    });

    it("handles /api/audit-log/sse client abort gracefully without metric count leaks", async () => {
      const controller = new AbortController();
      const request = new Request("http://localhost:3000/api/audit-log/sse", {
        signal: controller.signal,
      });

      const res = await auditSseGet(request);
      expect(res.status).toBe(200);

      const snapshotBefore = getSseActiveConnectionsSnapshot();
      expect(snapshotBefore["/api/audit-log/sse"]).toBe(1);

      // Abort connection
      controller.abort();

      const snapshotAfter = getSseActiveConnectionsSnapshot();
      expect(snapshotAfter["/api/audit-log/sse"]).toBe(0);

      const durations = getSseDurationMetrics();
      const auditDuration = durations.find((d) => d.route === "/api/audit-log/sse");
      expect(auditDuration).toBeDefined();
      expect(auditDuration!.observation.count).toBe(1);
    });

    it("handles pre-aborted request to /api/events cleanly", async () => {
      const controller = new AbortController();
      controller.abort();
      const request = new Request("http://localhost:3000/api/events", {
        signal: controller.signal,
      });

      await eventsGet(request);
      const snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/events"]).toBe(0);
    });

    it("handles pre-aborted request to /api/audit-log/sse cleanly", async () => {
      const controller = new AbortController();
      controller.abort();
      const request = new Request("http://localhost:3000/api/audit-log/sse", {
        signal: controller.signal,
      });

      const res = await auditSseGet(request);
      expect(res.status).toBe(499);
      const snapshot = getSseActiveConnectionsSnapshot();
      expect(snapshot["/api/audit-log/sse"] ?? 0).toBe(0);
    });
  });

  describe("Grafana Dashboard configuration (#1425)", () => {
    interface DashboardTarget {
      expr?: string;
      legendFormat?: string;
    }
    interface DashboardPanel {
      title?: string;
      type?: string;
      targets?: DashboardTarget[];
    }

    it("contains the active SSE connections panel with expected target query", () => {
      const dashboardPath = path.resolve(process.cwd(), "monitoring/grafana-dashboard.json");
      const content = fs.readFileSync(dashboardPath, "utf-8");
      const json = JSON.parse(content) as { panels: DashboardPanel[] };

      const ssePanel = json.panels.find((p) => p.title === "Active SSE Connections");
      expect(ssePanel).toBeDefined();
      expect(ssePanel?.type).toBe("timeseries");

      const target = ssePanel?.targets?.find(
        (t) => t.expr === "ophirpay_sse_active_connections"
      );
      expect(target).toBeDefined();
      expect(target?.legendFormat).toBe("{{route}}");
    });

    it("contains the SSE connection duration panel with expected target query", () => {
      const dashboardPath = path.resolve(process.cwd(), "monitoring/grafana-dashboard.json");
      const content = fs.readFileSync(dashboardPath, "utf-8");
      const json = JSON.parse(content) as { panels: DashboardPanel[] };

      const sseDurationPanel = json.panels.find((p) => p.title === "SSE Connection Duration");
      expect(sseDurationPanel).toBeDefined();
      expect(sseDurationPanel?.type).toBe("timeseries");

      const target = sseDurationPanel?.targets?.find(
        (t) => t.expr?.includes("ophirpay_sse_connection_duration_seconds_sum")
      );
      expect(target).toBeDefined();
      expect(target?.legendFormat).toBe("{{route}} (avg duration)");
    });
  });
});
