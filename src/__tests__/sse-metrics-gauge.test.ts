// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/events/event-source", () => ({
  createLiveEventSource: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/lib/stellar", () => ({
  getSorobanServer: () => ({
    getAccount: vi.fn().mockRejectedValue(new Error("offline in test")),
    simulateTransaction: vi.fn(),
  }),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

import {
  resetMetricsForTest,
  getSseMetricsSnapshot,
  incSseActiveConnection,
  decSseActiveConnection,
} from "@/lib/metrics-counters";
import { GET as getEventsSse } from "@/app/api/events/route";
import { GET as getAuditSse } from "@/app/api/audit-log/sse/route";
import { GET as getMetrics } from "@/app/api/metrics/route";

const METRICS_TOKEN = "test-metrics-token-0123456789abcdef";

function metricsRequest(): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
}

describe("SSE active connections gauge & disconnect duration telemetry (#1425)", () => {
  beforeEach(() => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    resetMetricsForTest();
  });

  it("increments sse_active_connections on /api/events connect and decrements + records duration on abort", async () => {
    const controller = new AbortController();
    const req = new Request("http://localhost/api/events", {
      signal: controller.signal,
    });

    const res = await getEventsSse(req);
    expect(res.status).toBe(200);

    // While stream is open, route gauge is 1
    let snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/events"]).toBe(1);
    expect(snap.activeByRoute["/api/audit-log/sse"]).toBe(0);

    const metricsOpenRes = await getMetrics(metricsRequest());
    const metricsOpenBody = await metricsOpenRes.text();
    expect(metricsOpenBody).toContain(
      'sse_active_connections{route="/api/events"} 1'
    );
    expect(metricsOpenBody).toContain(
      'sse_active_connections{route="/api/audit-log/sse"} 0'
    );

    // Simulate client disconnect via AbortSignal
    controller.abort();

    snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/events"]).toBe(0);
    expect(snap.durationByRoute["/api/events"]?.count).toBe(1);
    expect(snap.durationByRoute["/api/events"]?.sum).toBeGreaterThanOrEqual(0);

    // Verify Prometheus exposition includes histogram lines
    const metricsClosedRes = await getMetrics(metricsRequest());
    const metricsClosedBody = await metricsClosedRes.text();
    expect(metricsClosedBody).toContain(
      'sse_active_connections{route="/api/events"} 0'
    );
    expect(metricsClosedBody).toContain(
      "# TYPE sse_connection_duration_seconds histogram"
    );
    expect(metricsClosedBody).toContain(
      'sse_connection_duration_seconds_count{route="/api/events"} 1'
    );
    expect(metricsClosedBody).toContain(
      'sse_connection_duration_seconds_bucket{route="/api/events",le="+Inf"} 1'
    );
  });

  it("tracks /api/audit-log/sse active connections and records duration on stream cancel", async () => {
    const controller = new AbortController();
    const req = new Request("http://localhost/api/audit-log/sse", {
      signal: controller.signal,
    });

    const res = await getAuditSse(req);
    expect(res.status).toBe(200);

    let snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/audit-log/sse"]).toBe(1);

    // Cancel reader stream directly
    await res.body?.cancel();

    snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/audit-log/sse"]).toBe(0);
    expect(snap.durationByRoute["/api/audit-log/sse"]?.count).toBe(1);

    // Subsequent abort does not double-decrement or double-record
    controller.abort();
    snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/audit-log/sse"]).toBe(0);
    expect(snap.durationByRoute["/api/audit-log/sse"]?.count).toBe(1);
  });

  it("clamps active connections at 0 and buckets durations accurately", () => {
    incSseActiveConnection("/api/events");
    decSseActiveConnection("/api/events", 12.5);
    decSseActiveConnection("/api/events", 5.0);

    const snap = getSseMetricsSnapshot();
    expect(snap.activeByRoute["/api/events"]).toBe(0);
    expect(snap.durationByRoute["/api/events"]?.count).toBe(2);
    expect(snap.durationByRoute["/api/events"]?.sum).toBeCloseTo(17.5, 5);
    // 5s and 12.5s are both <= 15s (index 3: bounds [1, 5, 15, ...])
    expect(snap.durationByRoute["/api/events"]?.buckets[1]).toBe(1); // <= 5s
    expect(snap.durationByRoute["/api/events"]?.buckets[2]).toBe(2); // <= 15s
  });

  it("includes an Active SSE Connections panel in monitoring/grafana-dashboard.json", () => {
    const dashboardPath = path.resolve(
      process.cwd(),
      "monitoring/grafana-dashboard.json"
    );
    const dashboard = JSON.parse(fs.readFileSync(dashboardPath, "utf8"));
    const ssePanel = dashboard.panels.find(
      (p: { title?: string }) =>
        typeof p.title === "string" && p.title.includes("SSE Connections")
    );
    expect(ssePanel).toBeDefined();
    const exprs = ssePanel.targets.map((t: { expr: string }) => t.expr);
    expect(exprs).toContain("sse_active_connections");
  });
});
