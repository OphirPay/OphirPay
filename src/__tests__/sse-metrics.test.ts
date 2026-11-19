// SPDX-License-Identifier: MIT

/**
 * Issue #1425 — Add active SSE connection gauge and disconnect telemetry to Prometheus.
 *
 * Validates:
 * 1. Active SSE connection gauge tracking per route (increment, decrement, clamped at 0).
 * 2. SSE session duration histogram recordings across configurable buckets.
 * 3. Prometheus metrics exposition via buildMetrics() (/api/metrics).
 * 4. Grafana dashboard panel definitions for active SSE client connections.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  incSseActiveConnection,
  getSseActiveConnections,
  recordSseConnectionDuration,
  getSseDurations,
  resetMetricsForTest,
  SSE_DURATION_BUCKET_BOUNDS,
} from "@/lib/metrics-counters";
import { buildMetrics } from "@/app/api/metrics/route";

const repoRoot = process.cwd();

describe("SSE Prometheus Metrics (issue #1425)", () => {
  beforeEach(() => {
    resetMetricsForTest();
  });

  describe("Active SSE Connection Gauge", () => {
    it("initializes active connections to 0 for both routes", () => {
      const connections = getSseActiveConnections();
      expect(connections).toEqual(
        expect.arrayContaining([
          { route: "events", count: 0 },
          { route: "audit-log", count: 0 },
        ])
      );
    });

    it("increments and decrements active connection count for events route", () => {
      incSseActiveConnection("events", 1);
      incSseActiveConnection("events", 1);
      let connections = getSseActiveConnections();
      expect(connections.find((c) => c.route === "events")?.count).toBe(2);
      expect(connections.find((c) => c.route === "audit-log")?.count).toBe(0);

      incSseActiveConnection("events", -1);
      connections = getSseActiveConnections();
      expect(connections.find((c) => c.route === "events")?.count).toBe(1);
    });

    it("increments and decrements active connection count for audit-log route", () => {
      incSseActiveConnection("audit-log", 3);
      let connections = getSseActiveConnections();
      expect(connections.find((c) => c.route === "audit-log")?.count).toBe(3);

      incSseActiveConnection("audit-log", -2);
      connections = getSseActiveConnections();
      expect(connections.find((c) => c.route === "audit-log")?.count).toBe(1);
    });

    it("clamps active connection gauge to zero on excess disconnects", () => {
      incSseActiveConnection("events", -5);
      const connections = getSseActiveConnections();
      expect(connections.find((c) => c.route === "events")?.count).toBe(0);
    });
  });

  describe("SSE Connection Duration Histogram", () => {
    it("records duration observations into correct buckets", () => {
      recordSseConnectionDuration("events", 12.5); // <= 15
      recordSseConnectionDuration("events", 45); // <= 60
      recordSseConnectionDuration("events", 120); // <= 120

      const durations = getSseDurations();
      const eventsObs = durations.find((d) => d.route === "events")?.observation;

      expect(eventsObs).toBeDefined();
      expect(eventsObs?.count).toBe(3);
      expect(eventsObs?.sum).toBeCloseTo(177.5);

      // Bucket <= 15 should have 1 observation (12.5)
      const b15Index = SSE_DURATION_BUCKET_BOUNDS.indexOf(15);
      expect(eventsObs?.buckets[b15Index]).toBe(1);

      // Bucket <= 60 should have 2 observations (12.5, 45)
      const b60Index = SSE_DURATION_BUCKET_BOUNDS.indexOf(60);
      expect(eventsObs?.buckets[b60Index]).toBe(2);

      // Bucket +Inf should have all 3 observations
      expect(eventsObs?.buckets[SSE_DURATION_BUCKET_BOUNDS.length]).toBe(3);
    });

    it("tracks multiple routes independently", () => {
      recordSseConnectionDuration("events", 10);
      recordSseConnectionDuration("audit-log", 50);

      const durations = getSseDurations();
      const eventsObs = durations.find((d) => d.route === "events")?.observation;
      const auditObs = durations.find((d) => d.route === "audit-log")?.observation;

      expect(eventsObs?.count).toBe(1);
      expect(eventsObs?.sum).toBe(10);

      expect(auditObs?.count).toBe(1);
      expect(auditObs?.sum).toBe(50);
    });
  });

  describe("Prometheus /api/metrics Output", () => {
    it("exposes ophirpay_sse_active_connections gauge with route labels", async () => {
      incSseActiveConnection("events", 4);
      incSseActiveConnection("audit-log", 2);

      const metrics = await buildMetrics();

      expect(metrics).toContain("# TYPE ophirpay_sse_active_connections gauge");
      expect(metrics).toContain('ophirpay_sse_active_connections{route="events"} 4');
      expect(metrics).toContain('ophirpay_sse_active_connections{route="audit-log"} 2');
    });

    it("exposes ophirpay_sse_connection_duration_seconds histogram when observations exist", async () => {
      recordSseConnectionDuration("events", 20);

      const metrics = await buildMetrics();

      expect(metrics).toContain(
        "# TYPE ophirpay_sse_connection_duration_seconds histogram"
      );
      expect(metrics).toContain(
        'ophirpay_sse_connection_duration_seconds_bucket{route="events",le="30"} 1'
      );
      expect(metrics).toContain(
        'ophirpay_sse_connection_duration_seconds_sum{route="events"} 20.000'
      );
      expect(metrics).toContain(
        'ophirpay_sse_connection_duration_seconds_count{route="events"} 1'
      );
    });
  });

  describe("Grafana Dashboard Panels", () => {
    it("includes active SSE connections and session duration panels in grafana-dashboard.json", () => {
      const content = readFileSync(
        join(repoRoot, "monitoring", "grafana-dashboard.json"),
        "utf8"
      );
      const parsed = JSON.parse(content);
      const panels = parsed.panels as Array<{
        title: string;
        targets: Array<{ expr: string }>;
      }>;

      const activePanel = panels.find(
        (p) => p.title === "Active SSE Client Connections"
      );
      expect(activePanel).toBeDefined();
      expect(activePanel?.targets[0]?.expr).toBe("ophirpay_sse_active_connections");

      const durationPanel = panels.find(
        (p) => p.title === "SSE Client Session Duration"
      );
      expect(durationPanel).toBeDefined();
      expect(durationPanel?.targets[0]?.expr).toContain(
        "ophirpay_sse_connection_duration_seconds"
      );
    });
  });
});
