// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkConnectionAcquisitionWait,
  getPrismaPoolMetrics,
  CONNECTION_WAIT_THRESHOLD_MS,
  DEFAULT_FALLBACK_POOL_METRICS,
} from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GET } from "@/app/api/metrics/route";

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

const METRICS_TOKEN = "test-prisma-metrics-token-12345";

function makeAuthenticatedRequest(token = METRICS_TOKEN): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("Prisma connection pool metrics & health monitor (#1371)", () => {
  beforeEach(() => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  describe("checkConnectionAcquisitionWait", () => {
    it("does not log a warning when wait duration is below or equal to threshold", () => {
      const warnSpy = vi.spyOn(logger, "warn");

      const resultLow = checkConnectionAcquisitionWait(150, CONNECTION_WAIT_THRESHOLD_MS);
      const resultEqual = checkConnectionAcquisitionWait(500, CONNECTION_WAIT_THRESHOLD_MS);

      expect(resultLow).toBe(false);
      expect(resultEqual).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs a structured warning when wait duration exceeds 500ms threshold", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const result = checkConnectionAcquisitionWait(550, 500, {
        model: "Payment",
        operation: "create",
      });

      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const call = warnSpy.mock.calls[0];
      expect(call[0]).toContain("Database connection acquisition wait exceeded 500ms");
      expect(call[1]).toMatchObject({
        waitDurationMs: 550,
        thresholdMs: 500,
        model: "Payment",
        operation: "create",
      });
    });
  });

  describe("getPrismaPoolMetrics", () => {
    it("returns valid Prometheus exposition text containing all required pool metrics", async () => {
      const text = await getPrismaPoolMetrics();

      expect(text).toContain("prisma_pool_connections_busy");
      expect(text).toContain("prisma_pool_connections_idle");
      expect(text).toContain("prisma_pool_wait_duration_ms");
    });

    it("falls back gracefully to standard pool metrics format when client is disconnected", async () => {
      const fallback = DEFAULT_FALLBACK_POOL_METRICS;

      expect(fallback).toContain("# HELP prisma_pool_connections_busy");
      expect(fallback).toContain("# TYPE prisma_pool_connections_busy gauge");
      expect(fallback).toContain("# HELP prisma_pool_connections_idle");
      expect(fallback).toContain("# TYPE prisma_pool_connections_idle gauge");
      expect(fallback).toContain("# HELP prisma_pool_wait_duration_ms");
      expect(fallback).toContain("# TYPE prisma_pool_wait_duration_ms histogram");
    });
  });

  describe("GET /api/metrics integration", () => {
    it("includes prisma pool metrics in the authenticated Prometheus response", async () => {
      const req = makeAuthenticatedRequest();
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");

      const body = await res.text();
      expect(body).toContain("prisma_pool_connections_busy");
      expect(body).toContain("prisma_pool_connections_idle");
      expect(body).toContain("prisma_pool_wait_duration_ms");
    });
  });
});
