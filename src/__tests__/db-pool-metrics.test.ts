// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logSlowConnectionWait,
  CONNECTION_WAIT_WARN_THRESHOLD_MS,
  getPrismaMetrics,
} from "@/lib/prisma";
import { buildMetrics, GET } from "@/app/api/metrics/route";
import fs from "fs";
import path from "path";

describe("Database Connection Pool Health Monitor & Metrics (#1371)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.METRICS_TOKEN = "test-token";
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  describe("Slow Connection Acquisition Warning Logs", () => {
    it("logs a structured warning when connection wait duration exceeds 500ms", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logSlowConnectionWait(650, { model: "Payment", operation: "create" });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const loggedJson = JSON.parse(warnSpy.mock.calls[0][0]);

      expect(loggedJson.level).toBe("warn");
      expect(loggedJson.event).toBe("database_slow_connection_wait");
      expect(loggedJson.durationMs).toBe(650);
      expect(loggedJson.thresholdMs).toBe(CONNECTION_WAIT_WARN_THRESHOLD_MS);
      expect(loggedJson.context).toEqual({ model: "Payment", operation: "create" });
      expect(loggedJson.message).toContain("650ms");

      warnSpy.mockRestore();
    });

    it("does not log a warning when connection wait duration is within threshold (<= 500ms)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      logSlowConnectionWait(300, { model: "User", operation: "findUnique" });
      logSlowConnectionWait(500, { model: "ApiKey", operation: "count" });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("Prisma Metrics Extraction & Prometheus Exposition", () => {
    it("returns Prometheus format metrics string containing connection pool gauges", async () => {
      const metricsText = await getPrismaMetrics();

      expect(metricsText).toContain("prisma_pool_connections_busy");
      expect(metricsText).toContain("prisma_pool_connections_idle");
      expect(metricsText).toContain("prisma_pool_wait_duration_ms");
    });

    it("integrates database pool metrics into buildMetrics() output", async () => {
      const fullExposition = await buildMetrics();

      expect(fullExposition).toContain("# HELP prisma_pool_connections_busy");
      expect(fullExposition).toContain("# TYPE prisma_pool_connections_busy gauge");
      expect(fullExposition).toContain("# HELP prisma_pool_connections_idle");
      expect(fullExposition).toContain("# TYPE prisma_pool_connections_idle gauge");
      expect(fullExposition).toContain("# HELP prisma_pool_wait_duration_ms");
      expect(fullExposition).toContain("# TYPE prisma_pool_wait_duration_ms gauge");
    });

    it("serves database pool metrics over authenticated /api/metrics endpoint", async () => {
      const req = new Request("http://localhost/api/metrics", {
        headers: {
          authorization: "Bearer test-token",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);

      const body = await res.text();
      expect(body).toContain("prisma_pool_connections_busy");
      expect(body).toContain("prisma_pool_connections_idle");
      expect(body).toContain("prisma_pool_wait_duration_ms");
    });
  });

  describe("Documentation Integrity (docs/DATABASE_PROVIDERS.md)", () => {
    it("contains connection pool sizing, tuning recommendations, and wait alerts", () => {
      const docPath = path.resolve(__dirname, "../../docs/DATABASE_PROVIDERS.md");
      const content = fs.readFileSync(docPath, "utf-8");

      expect(content).toContain("### Connection Pool Sizing and Health Monitoring");
      expect(content).toContain("connection_limit");
      expect(content).toContain("pool_timeout");
      expect(content).toContain("connect_timeout");
      expect(content).toContain("prisma_pool_connections_busy");
      expect(content).toContain("prisma_pool_connections_idle");
      expect(content).toContain("prisma_pool_wait_duration_ms");
      expect(content).toContain("database_slow_connection_wait");
      expect(content).toContain("CONNECTION_WAIT_WARN_THRESHOLD_MS");
    });
  });
});
