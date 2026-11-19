// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DB_POOL_WAIT_THRESHOLD_MS,
  checkConnectionAcquisitionWait,
  getPrismaPoolMetrics,
  getPrismaPrometheusMetrics,
} from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { buildMetrics } from "@/app/api/metrics/route";

describe("Database Connection Pool Monitoring & Telemetry (#1371)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("DB_POOL_WAIT_THRESHOLD_MS", () => {
    it("is configured to 500 milliseconds", () => {
      expect(DB_POOL_WAIT_THRESHOLD_MS).toBe(500);
    });
  });

  describe("checkConnectionAcquisitionWait", () => {
    it("logs a structured warning when wait duration exceeds threshold", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const result = checkConnectionAcquisitionWait(550, "findMany", "User");

      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Database connection acquisition or query wait exceeded threshold",
        {
          durationMs: 550,
          thresholdMs: 500,
          operation: "findMany",
          model: "User",
        }
      );
    });

    it("does not log a warning when wait duration is below or equal to threshold", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const resultBelow = checkConnectionAcquisitionWait(499);
      const resultExact = checkConnectionAcquisitionWait(500);

      expect(resultBelow).toBe(false);
      expect(resultExact).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("getPrismaPoolMetrics", () => {
    it("returns default zeroed metrics in offline/test environment", async () => {
      const metrics = await getPrismaPoolMetrics();
      expect(metrics).toEqual({
        busy: expect.any(Number),
        idle: expect.any(Number),
        open: expect.any(Number),
        waitDurationMsSum: expect.any(Number),
        waitDurationMsCount: expect.any(Number),
      });
    });
  });

  describe("getPrismaPrometheusMetrics", () => {
    it("returns valid Prometheus exposition format for connection pool metrics", async () => {
      const exposition = await getPrismaPrometheusMetrics();

      expect(exposition).toContain("# HELP prisma_pool_connections_busy");
      expect(exposition).toContain("# TYPE prisma_pool_connections_busy gauge");
      expect(exposition).toContain("prisma_pool_connections_busy");

      expect(exposition).toContain("# HELP prisma_pool_connections_idle");
      expect(exposition).toContain("# TYPE prisma_pool_connections_idle gauge");
      expect(exposition).toContain("prisma_pool_connections_idle");

      expect(exposition).toContain("# HELP prisma_pool_connections_open");
      expect(exposition).toContain("# TYPE prisma_pool_connections_open gauge");
      expect(exposition).toContain("prisma_pool_connections_open");

      expect(exposition).toContain("# HELP prisma_pool_wait_duration_ms");
      expect(exposition).toContain("# TYPE prisma_pool_wait_duration_ms histogram");
      expect(exposition).toContain("prisma_pool_wait_duration_ms_bucket");
      expect(exposition).toContain("prisma_pool_wait_duration_ms_sum");
      expect(exposition).toContain("prisma_pool_wait_duration_ms_count");
    });
  });

  describe("buildMetrics integration", () => {
    it("includes prisma pool metrics in /api/metrics payload", async () => {
      const output = await buildMetrics();

      expect(output).toContain("prisma_pool_connections_busy");
      expect(output).toContain("prisma_pool_connections_idle");
      expect(output).toContain("prisma_pool_connections_open");
      expect(output).toContain("prisma_pool_wait_duration_ms");
    });
  });
});
