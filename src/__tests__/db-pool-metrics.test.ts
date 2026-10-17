// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma, {
  DB_POOL_WAIT_WARN_THRESHOLD_MS,
  collectPrismaPoolMetrics,
  getDbPoolMetricsSnapshot,
  parsePrismaPrometheusMetrics,
  recordDbPoolAcquisition,
  resetDbPoolMetrics,
  setDbPoolMetrics,
} from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { GET } from "@/app/api/metrics/route";

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

const METRICS_TOKEN = "test-metrics-token-1371";

function authenticatedMetricsRequest(): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
}

describe("Database connection pool health monitor & Prometheus metrics (#1371)", () => {
  beforeEach(() => {
    resetDbPoolMetrics();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
  });

  afterEach(() => {
    resetDbPoolMetrics();
    delete process.env.METRICS_TOKEN;
    delete (prisma as unknown as { $metrics?: unknown }).$metrics;
    vi.restoreAllMocks();
  });

  it("logs a structured warning when pool connection acquisition wait exceeds 500ms", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(DB_POOL_WAIT_WARN_THRESHOLD_MS).toBe(500);

    // Sub-threshold acquisition (<= 500ms) does not log a warning
    recordDbPoolAcquisition(320, { model: "Payment", action: "findMany" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(getDbPoolMetricsSnapshot().waitDurationMs).toBe(320);
    expect(getDbPoolMetricsSnapshot().slowAcquireCount).toBe(0);

    // Slow acquisition (> 500ms) emits a structured warning log
    setDbPoolMetrics({ busy: 8, idle: 2 });
    recordDbPoolAcquisition(645.5, { model: "Batch", action: "create" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Database connection pool acquisition wait exceeded 500ms",
      expect.objectContaining({
        waitDurationMs: 645.5,
        thresholdMs: 500,
        busyConnections: 8,
        idleConnections: 2,
        model: "Batch",
        action: "create",
      })
    );

    const snapshot = getDbPoolMetricsSnapshot();
    expect(snapshot.waitDurationMs).toBe(645.5);
    expect(snapshot.maxWaitDurationMs).toBe(645.5);
    expect(snapshot.slowAcquireCount).toBe(1);
  });

  it("parses prisma.$metrics.prometheus() output and falls back gracefully on error", async () => {
    const samplePrometheus = [
      "# HELP prisma_pool_connections_busy Number of busy connections",
      "# TYPE prisma_pool_connections_busy gauge",
      "prisma_pool_connections_busy 6",
      "# HELP prisma_pool_connections_idle Number of idle connections",
      "# TYPE prisma_pool_connections_idle gauge",
      "prisma_pool_connections_idle 14",
      "# HELP prisma_pool_wait_duration_ms Pool wait duration",
      "# TYPE prisma_pool_wait_duration_ms gauge",
      "prisma_pool_wait_duration_ms 42.5",
    ].join("\n");

    const parsed = parsePrismaPrometheusMetrics(samplePrometheus);
    expect(parsed.busy).toBe(6);
    expect(parsed.idle).toBe(14);
    expect(parsed.waitDurationMs).toBe(42.5);

    const mockClient = {
      $metrics: {
        prometheus: vi.fn().mockResolvedValue(samplePrometheus),
      },
    };

    const collected = await collectPrismaPoolMetrics(mockClient);
    expect(collected).toMatchObject({
      busy: 6,
      idle: 14,
      waitDurationMs: 42.5,
    });
  });

  it("exposes prisma_pool_connections_busy, prisma_pool_connections_idle, and prisma_pool_wait_duration_ms on GET /api/metrics", async () => {
    setDbPoolMetrics({ busy: 4, idle: 6, waitDurationMs: 185 });

    const res = await GET(authenticatedMetricsRequest());
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain(
      "# HELP prisma_pool_connections_busy Number of currently busy database pool connections"
    );
    expect(text).toContain("# TYPE prisma_pool_connections_busy gauge");
    expect(text).toContain("prisma_pool_connections_busy 4");

    expect(text).toContain(
      "# HELP prisma_pool_connections_idle Number of currently idle database pool connections"
    );
    expect(text).toContain("# TYPE prisma_pool_connections_idle gauge");
    expect(text).toContain("prisma_pool_connections_idle 6");

    expect(text).toContain(
      "# HELP prisma_pool_wait_duration_ms Database connection pool acquisition wait duration in milliseconds"
    );
    expect(text).toContain("# TYPE prisma_pool_wait_duration_ms gauge");
    expect(text).toContain("prisma_pool_wait_duration_ms 185");
  });

  it("reads live metrics from prisma.$metrics.prometheus() in GET /api/metrics when available", async () => {
    (
      prisma as unknown as {
        $metrics?: { prometheus: () => Promise<string> };
      }
    ).$metrics = {
      prometheus: vi
        .fn()
        .mockResolvedValue(
          [
            "prisma_pool_connections_busy 9",
            "prisma_pool_connections_idle 1",
            "prisma_pool_wait_duration_ms 512",
          ].join("\n")
        ),
    };

    const res = await GET(authenticatedMetricsRequest());
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("prisma_pool_connections_busy 9");
    expect(text).toContain("prisma_pool_connections_idle 1");
    expect(text).toContain("prisma_pool_wait_duration_ms 512");
  });
});
