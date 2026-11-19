// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RpcCircuitBreaker,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
  resetCircuitBreakerForTest,
} from "@/lib/rpc-circuit-breaker";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";
import { GET } from "@/app/api/health/route";

describe("Soroban RPC Circuit Breaker (Issue #1421)", () => {
  const primaryUrl = "https://primary-rpc.stellar.org";
  const secondaryUrl = "https://secondary-rpc.stellar.org";

  let breaker: RpcCircuitBreaker;

  beforeEach(() => {
    resetMetricsForTest();
    resetCircuitBreakerForTest();
    vi.useFakeTimers();
    breaker = new RpcCircuitBreaker(primaryUrl, [secondaryUrl]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("initializes in CLOSED state with primary endpoint", () => {
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getActiveEndpoint()).toBe(primaryUrl);
    const snapshot = breaker.getSnapshot();
    expect(snapshot.state).toBe("CLOSED");
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.failureThreshold).toBe(5);
    expect(snapshot.usingFallback).toBe(false);
  });

  it("remains in CLOSED state for failures below threshold (< 5)", () => {
    for (let i = 1; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure(primaryUrl, new Error("HTTP 500"));
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getActiveEndpoint()).toBe(primaryUrl);
      expect(breaker.getSnapshot().consecutiveFailures).toBe(i);
    }

    // A success resets consecutive failure counter
    breaker.recordSuccess(primaryUrl);
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("trips to OPEN state on 5 consecutive failures and fails over to secondary", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure(primaryUrl, new Error("Gateway Timeout"));
    }

    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getActiveEndpoint()).toBe(secondaryUrl);
    const snapshot = breaker.getSnapshot();
    expect(snapshot.usingFallback).toBe(true);
    expect(snapshot.tripsTotal).toBe(1);

    // Verify Prometheus metric increment
    const metrics = getMetricsSnapshot();
    expect(metrics.rpc_circuit_breaker_trips_total).toBe(1);
  });

  it("rapidly serves from fallback during 30s cooldown without thread starvation", () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure(primaryUrl, new Error("Timeout"));
    }

    expect(breaker.getState()).toBe("OPEN");

    // 15 seconds into cooldown: still OPEN, returns secondary without polling primary
    vi.advanceTimersByTime(15_000);
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getActiveEndpoint()).toBe(secondaryUrl);
  });

  it("transitions to HALF_OPEN after 30s cooldown and recovers to CLOSED on successful probe", async () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure(primaryUrl, new Error("Timeout"));
    }
    expect(breaker.getState()).toBe("OPEN");

    // Advance clock past 30s cooldown
    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS + 100);
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Mock successful getLatestLedger probe response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { sequence: 123456 },
      }),
    });

    const recovered = await breaker.probePrimaryRecovery();
    expect(recovered).toBe(true);
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getActiveEndpoint()).toBe(primaryUrl);
    expect(breaker.getSnapshot().usingFallback).toBe(false);
  });

  it("re-trips to OPEN state if health probe fails during HALF_OPEN", async () => {
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      breaker.recordFailure(primaryUrl, new Error("Timeout"));
    }

    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS + 100);
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Mock failed probe
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const recovered = await breaker.probePrimaryRecovery();
    expect(recovered).toBe(false);
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getActiveEndpoint()).toBe(secondaryUrl);
    expect(breaker.getSnapshot().tripsTotal).toBe(2);
  });

  it("exposes circuit breaker telemetry in GET /api/health", async () => {
    const res = await GET(new Request("http://localhost/api/health?probe=rpc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data ?? body;
    expect(data.circuitBreaker).toBeDefined();
    expect(data.circuitBreaker.state).toBe("CLOSED");
    expect(data.circuitBreaker.failureThreshold).toBe(5);
    expect(data.circuitBreaker.cooldownMs).toBe(30000);
  });
});
