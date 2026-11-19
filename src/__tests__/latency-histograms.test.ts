// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it } from "vitest";
import {
  DB_LATENCY_BUCKET_BOUNDS,
  RPC_LATENCY_BUCKET_BOUNDS,
  getDbQueryMetrics,
  getRpcCallMetrics,
  recordDbQuery,
  recordRpcCall,
  resetMetricsForTest,
} from "@/lib/metrics-counters";
import { buildMetrics } from "@/app/api/metrics/route";

describe("RPC latency histograms", () => {
  beforeEach(() => resetMetricsForTest());

  it("uses the documented SLO buckets", () => {
    expect(RPC_LATENCY_BUCKET_BOUNDS).toEqual([0.1, 0.5, 1, 3, 5, 10]);
  });

  it("records per-endpoint/outcome counts in cumulative buckets", () => {
    recordRpcCall("https://rpc.primary.example", "success", 0.05);
    recordRpcCall("https://rpc.primary.example", "success", 0.4);
    recordRpcCall("https://rpc.primary.example", "failure", 0.75);
    recordRpcCall("https://rpc.fallback.example", "success", 4);

    const primarySuccess = getRpcCallMetrics().find(
      (m) => m.endpoint === "https://rpc.primary.example" && m.outcome === "success"
    );
    expect(primarySuccess?.count).toBe(2);
    // 50ms and 400ms both fall in the 500ms bucket.
    expect(primarySuccess?.buckets[1]).toBe(2);
    expect(primarySuccess?.buckets[RPC_LATENCY_BUCKET_BOUNDS.length]).toBe(2);
    expect(primarySuccess?.sum).toBeCloseTo(0.45);

    const fallback = getRpcCallMetrics().find(
      (m) => m.endpoint === "https://rpc.fallback.example"
    );
    // 4s falls in the 5s bucket.
    expect(fallback?.buckets[4]).toBe(1);
  });

  it("exposes the histogram at /api/metrics", async () => {
    recordRpcCall("https://rpc.primary.example", "success", 0.2);

    const body = await buildMetrics();

    expect(body).toContain(
      "# TYPE ophirpay_rpc_call_duration_seconds histogram"
    );
    expect(body).toContain(
      'ophirpay_rpc_call_duration_seconds_bucket{endpoint="https://rpc.primary.example",outcome="success",le="0.1"} 0'
    );
    expect(body).toContain(
      'ophirpay_rpc_call_duration_seconds_bucket{endpoint="https://rpc.primary.example",outcome="success",le="0.5"} 1'
    );
    expect(body).toContain(
      'ophirpay_rpc_call_duration_seconds_bucket{endpoint="https://rpc.primary.example",outcome="success",le="+Inf"} 1'
    );
    expect(body).toContain(
      'ophirpay_rpc_call_duration_seconds_count{endpoint="https://rpc.primary.example",outcome="success"} 1'
    );
  });
});

describe("Prisma query latency histograms", () => {
  beforeEach(() => resetMetricsForTest());

  it("records a histogram per model and operation", () => {
    recordDbQuery("Payment", "findMany", 0.02);
    recordDbQuery("Payment", "findMany", 0.3);
    recordDbQuery("User", "findUnique", 0.006);

    const payment = getDbQueryMetrics().find(
      (m) => m.model === "Payment" && m.operation === "findMany"
    );
    expect(payment?.count).toBe(2);
    expect(payment?.buckets[2]).toBe(1); // 20ms in the 25ms bucket
    expect(payment?.buckets[7]).toBe(2); // 300ms in the 1s bucket

    const user = getDbQueryMetrics().find((m) => m.model === "User");
    expect(user?.count).toBe(1);
    expect(user?.buckets[1]).toBe(1); // 6ms in the 10ms bucket
  });

  it("exposes the histogram with model and operation labels", async () => {
    recordDbQuery("Payment", "create", DB_LATENCY_BUCKET_BOUNDS[2]);

    const body = await buildMetrics();

    expect(body).toContain(
      "# TYPE ophirpay_prisma_query_duration_seconds histogram"
    );
    expect(body).toContain(
      'ophirpay_prisma_query_duration_seconds_bucket{model="Payment",operation="create",le="0.005"} 0'
    );
    expect(body).toContain(
      'ophirpay_prisma_query_duration_seconds_bucket{model="Payment",operation="create",le="0.025"} 1'
    );
    expect(body).toContain(
      'ophirpay_prisma_query_duration_seconds_count{model="Payment",operation="create"} 1'
    );
  });

  it("keeps the legacy aggregate summary in sync", async () => {
    recordDbQuery("Payment", "findMany", 0.012);

    const body = await buildMetrics();
    expect(body).toContain("ophirpay_db_query_duration_seconds_count 1");
  });
});
