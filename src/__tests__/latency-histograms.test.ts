// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordRpcCallLatency,
  getRpcCallMetrics,
  resetRpcCallMetrics,
  RPC_LATENCY_BUCKET_BOUNDS,
  recordDbQueryLatency,
  getDbQueryMetrics,
  resetDbQueryMetrics,
  DB_LATENCY_BUCKET_BOUNDS,
  resetMetricsForTest,
  getMetricsSnapshot,
} from "@/lib/metrics-counters";
import { instrumentRpcCall } from "@/lib/rpc-failover";
import { GET } from "@/app/api/metrics/route";

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

const METRICS_TOKEN = "test-token-1304";

function authenticatedRequest(): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
}

describe("Soroban RPC Call Latency Histograms (#1304)", () => {
  beforeEach(() => {
    resetRpcCallMetrics();
  });

  it("records latency in the correct buckets and tracks sum/count", () => {
    expect(RPC_LATENCY_BUCKET_BOUNDS).toEqual([0.1, 0.5, 1, 3, 5, 10]);
    const url = "https://soroban-testnet.stellar.org:443";
    // 0.05s -> <= 0.1s
    recordRpcCallLatency(url, "success", 0.05);
    // 0.8s -> <= 1s, <= 3s, <= 5s, <= 10s, +Inf
    recordRpcCallLatency(url, "success", 0.8);
    // 12s -> +Inf only
    recordRpcCallLatency(url, "error", 12.0);

    const metrics = getRpcCallMetrics();
    expect(metrics).toHaveLength(2);

    const successMetric = metrics.find((m) => m.status === "success");
    expect(successMetric).toBeDefined();
    expect(successMetric?.observation.latencyCount).toBe(2);
    expect(successMetric?.observation.latencySum).toBeCloseTo(0.85);

    // Bounds: [0.1, 0.5, 1, 3, 5, 10]
    // 0.05 qualifies for all buckets
    // 0.8 qualifies for bounds >= 1
    const b = successMetric!.observation.buckets;
    expect(b[0]).toBe(1); // <= 0.1
    expect(b[1]).toBe(1); // <= 0.5
    expect(b[2]).toBe(2); // <= 1
    expect(b[3]).toBe(2); // <= 3
    expect(b[4]).toBe(2); // <= 5
    expect(b[5]).toBe(2); // <= 10
    expect(b[6]).toBe(2); // +Inf

    const errorMetric = metrics.find((m) => m.status === "error");
    expect(errorMetric).toBeDefined();
    expect(errorMetric?.observation.latencyCount).toBe(1);
    expect(errorMetric?.observation.latencySum).toBeCloseTo(12.0);
    // 12s only in +Inf
    expect(errorMetric!.observation.buckets[0]).toBe(0);
    expect(errorMetric!.observation.buckets[5]).toBe(0);
    expect(errorMetric!.observation.buckets[6]).toBe(1);
  });

  it("instruments an async operation via instrumentRpcCall", async () => {
    const url = "https://rpc-futurenet.stellar.org:443";

    const result = await instrumentRpcCall(url, "getHealth", async () => {
      return "healthy";
    });
    expect(result).toBe("healthy");

    let metrics = getRpcCallMetrics();
    const successEntry = metrics.find((m) => m.endpoint === url && m.status === "success");
    expect(successEntry).toBeDefined();
    expect(successEntry?.observation.latencyCount).toBe(1);

    // Fails on error
    await expect(
      instrumentRpcCall(url, "getHealth", async () => {
        throw new Error("RPC timeout");
      })
    ).rejects.toThrow("RPC timeout");

    metrics = getRpcCallMetrics();
    const errorEntry = metrics.find((m) => m.endpoint === url && m.status === "error");
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.observation.latencyCount).toBe(1);
  });
});

describe("Prisma Database Query Latency Histograms (#1304)", () => {
  beforeEach(() => {
    resetDbQueryMetrics();
    resetMetricsForTest();
  });

  it("records db query latency by model and operation and syncs legacy counters", () => {
    expect(DB_LATENCY_BUCKET_BOUNDS).toEqual([
      0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5,
    ]);
    recordDbQueryLatency("Payment", "findMany", 0.012); // 12ms
    recordDbQueryLatency("Payment", "findMany", 0.045); // 45ms
    recordDbQueryLatency("Webhook", "create", 0.003);   // 3ms

    const metrics = getDbQueryMetrics();
    expect(metrics).toHaveLength(2);

    const paymentFindMany = metrics.find(
      (m) => m.model === "Payment" && m.operation === "findMany"
    );
    expect(paymentFindMany).toBeDefined();
    expect(paymentFindMany?.observation.latencyCount).toBe(2);
    expect(paymentFindMany?.observation.latencySum).toBeCloseTo(0.057);

    // Verify aggregate counters in getMetricsSnapshot
    const snapshot = getMetricsSnapshot();
    expect(snapshot.db_query_duration_seconds_count).toBe(3);
    expect(snapshot.db_query_duration_seconds_sum).toBeCloseTo(0.06);
  });
});

describe("Metrics Exposition Route (#1304)", () => {
  beforeEach(() => {
    resetMetricsForTest();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("exposes both RPC and DB histograms in valid Prometheus exposition text", async () => {
    recordRpcCallLatency("https://soroban-testnet.stellar.org:443", "success", 0.25);
    recordDbQueryLatency("Payment", "update", 0.015);

    const res = await GET(authenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.text();

    // Check RPC Histogram output
    expect(body).toContain("# HELP ophirpay_rpc_call_duration_seconds Soroban RPC call latency histogram");
    expect(body).toContain("# TYPE ophirpay_rpc_call_duration_seconds histogram");
    expect(body).toContain('ophirpay_rpc_call_duration_seconds_bucket{endpoint="https://soroban-testnet.stellar.org:443",status="success",le="0.5"} 1');
    expect(body).toContain('ophirpay_rpc_call_duration_seconds_bucket{endpoint="https://soroban-testnet.stellar.org:443",status="success",le="+Inf"} 1');
    expect(body).toContain('ophirpay_rpc_call_duration_seconds_count{endpoint="https://soroban-testnet.stellar.org:443",status="success"} 1');

    // Check DB Histogram output
    expect(body).toContain("# HELP ophirpay_db_query_duration_seconds Database query duration histogram by model and operation");
    expect(body).toContain("# TYPE ophirpay_db_query_duration_seconds histogram");
    expect(body).toContain('ophirpay_db_query_duration_seconds_bucket{model="Payment",operation="update",le="0.025"} 1');
    expect(body).toContain('ophirpay_db_query_duration_seconds_bucket{model="Payment",operation="update",le="+Inf"} 1');
    expect(body).toContain('ophirpay_db_query_duration_seconds_count{model="Payment",operation="update"} 1');
  });
});
