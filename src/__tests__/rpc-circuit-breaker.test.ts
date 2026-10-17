// SPDX-License-Identifier: MIT
/**
 * Issue #1421 — Add circuit breaker and health probe fallback for Soroban RPC
 * provider outages.
 *
 * Verifies:
 *   • `RpcCircuitBreaker` state transitions (`CLOSED` → `OPEN` after 5 consecutive
 *     failures → `HALF_OPEN` after 30s cooldown → `CLOSED` on `getLatestLedger`
 *     recovery probe or back to `OPEN` on probe failure).
 *   • Fail-fast `CircuitOpenError` during `OPEN` state to prevent API request
 *     thread starvation.
 *   • Automatic failover to secondary Soroban RPC URLs in `stellar-rpc.ts`
 *     when the primary provider circuit trips `OPEN`.
 *   • `/api/health` exposes `rpcCircuitBreaker` state and `/api/metrics`
 *     exposes `ophirpay_rpc_circuit_breaker_trips_total`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitOpenError,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_FAILURE_THRESHOLD,
  RpcCircuitBreaker,
  getEndpointCircuitBreaker,
  getRpcCircuitBreakerSnapshot,
  probeLatestLedger,
  resetRpcCircuitBreakers,
} from "@/lib/rpc-circuit-breaker";
import {
  executeSorobanRpcWithFailover,
  executeHorizonWithCircuitBreaker,
} from "@/lib/stellar-rpc";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const originalFetch = global.fetch;

const PRIMARY_RPC = "https://soroban-primary.example.org";
const SECONDARY_RPC = "https://soroban-secondary.example.org";

describe("Soroban RPC Circuit Breaker & Health Probe (issue #1421)", () => {
  let nowMs = 1_700_000_000_000;

  function advanceTime(ms: number) {
    nowMs += ms;
    vi.setSystemTime(nowMs);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nowMs = 1_700_000_000_000;
    vi.setSystemTime(nowMs);
    resetRpcCircuitBreakers();
    resetMetricsForTest();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    resetRpcCircuitBreakers();
    resetMetricsForTest();
  });

  it("stays CLOSED below threshold and trips OPEN on the 5th consecutive failure", async () => {
    const breaker = getEndpointCircuitBreaker(PRIMARY_RPC);
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.failureThreshold).toBe(DEFAULT_FAILURE_THRESHOLD);
    expect(breaker.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);

    for (let i = 1; i <= 4; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error(`RPC timeout #${i}`);
        })
      ).rejects.toThrow(`RPC timeout #${i}`);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getSnapshot().consecutiveFailures).toBe(i);
    }

    // 5th consecutive failure trips the circuit OPEN
    await expect(
      breaker.execute(async () => {
        throw new Error("RPC timeout #5");
      })
    ).rejects.toThrow("RPC timeout #5");

    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getSnapshot().tripCount).toBe(1);
    expect(getMetricsSnapshot().rpc_circuit_breaker_trips_total).toBe(1);
    expect(getRpcCircuitBreakerSnapshot().tripsTotal).toBe(1);
    expect(getRpcCircuitBreakerSnapshot().state).toBe("OPEN");
  });

  it("fails fast with CircuitOpenError while OPEN without invoking the operation", async () => {
    const breaker = new RpcCircuitBreaker({
      endpoint: PRIMARY_RPC,
      failureThreshold: 5,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error("503 Service Unavailable"));
    }
    expect(breaker.getState()).toBe("OPEN");

    advanceTime(10_000); // 20s remaining in cooldown
    const operationSpy = vi.fn().mockResolvedValue("ok");

    await expect(breaker.execute(operationSpy)).rejects.toBeInstanceOf(
      CircuitOpenError
    );
    expect(operationSpy).not.toHaveBeenCalled();
  });

  it("transitions to HALF_OPEN after 30s cooldown, probes getLatestLedger, and returns to CLOSED on success", async () => {
    const breaker = getEndpointCircuitBreaker(PRIMARY_RPC);
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure("upstream timeout");
    }
    expect(breaker.getState()).toBe("OPEN");

    // Advance past the 30-second cooldown window
    advanceTime(DEFAULT_COOLDOWN_MS + 100);
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Mock getLatestLedger JSON-RPC response
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.method).toBe("getLatestLedger");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { id: "ledger-hash", protocolVersion: 21, sequence: 987654 },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await breaker.execute(async () => "ledger-op-ok");
    expect(result).toBe("ledger-op-ok");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
    expect(breaker.getSnapshot().latestLedgerSequence).toBe(987654);
    expect(breaker.getSnapshot().lastProbeSuccess).toBe(true);
  });

  it("re-trips immediately from HALF_OPEN to OPEN when the getLatestLedger probe fails", async () => {
    const breaker = getEndpointCircuitBreaker(PRIMARY_RPC);
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure("connection reset");
    }
    expect(breaker.getState()).toBe("OPEN");
    expect(getMetricsSnapshot().rpc_circuit_breaker_trips_total).toBe(1);

    advanceTime(DEFAULT_COOLDOWN_MS + 50);
    expect(breaker.getState()).toBe("HALF_OPEN");

    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
    })) as unknown as typeof fetch;

    const opSpy = vi.fn();
    await expect(breaker.execute(opSpy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(opSpy).not.toHaveBeenCalled();
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getSnapshot().tripCount).toBe(2);
    expect(getMetricsSnapshot().rpc_circuit_breaker_trips_total).toBe(2);
  });

  it("probeLatestLedger handles RPC errors and AbortError timeouts cleanly", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Internal RPC error" },
      }),
    })) as unknown as typeof fetch;

    const rpcErr = await probeLatestLedger(PRIMARY_RPC, 1000);
    expect(rpcErr.ok).toBe(false);
    expect(rpcErr.reason).toBe("Internal RPC error");

    global.fetch = vi.fn(async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    const timeoutRes = await probeLatestLedger(PRIMARY_RPC, 1000);
    expect(timeoutRes.ok).toBe(false);
    expect(timeoutRes.reason).toBe("timeout");
  });

  it("automatically fails over to secondary RPC URL when primary circuit is OPEN and recovers after cooldown", async () => {
    const urls = [PRIMARY_RPC, SECONDARY_RPC];

    // Trip primary circuit by failing 5 consecutive times on primary while secondary also fails first 4 times,
    // or trip primary directly via executeSorobanRpcWithFailover when primary fails and secondary succeeds.
    let primaryHealthy = false;
    const callLog: string[] = [];

    for (let i = 1; i <= 5; i++) {
      const res = await executeSorobanRpcWithFailover(
        async (_server, endpointUrl) => {
          callLog.push(endpointUrl);
          if (endpointUrl === PRIMARY_RPC && !primaryHealthy) {
            throw new Error("primary 503");
          }
          return `served-by-${endpointUrl}`;
        },
        { urls }
      );
      expect(res.endpointUrl).toBe(SECONDARY_RPC);
      expect(res.usedFallback).toBe(true);
    }

    // Primary has now failed 5 times -> circuit is OPEN!
    const primaryBreaker = getEndpointCircuitBreaker(PRIMARY_RPC);
    expect(primaryBreaker.getState()).toBe("OPEN");

    // 6th call skips PRIMARY_RPC completely (fail-fast on primary) and goes straight to SECONDARY_RPC!
    callLog.length = 0;
    const sixth = await executeSorobanRpcWithFailover(
      async (_server, endpointUrl) => {
        callLog.push(endpointUrl);
        return `served-by-${endpointUrl}`;
      },
      { urls }
    );
    expect(sixth.endpointUrl).toBe(SECONDARY_RPC);
    expect(sixth.usedFallback).toBe(true);
    expect(callLog).toEqual([SECONDARY_RPC]);

    // Advance 30s cooldown and restore primary + mock getLatestLedger recovery probe
    advanceTime(DEFAULT_COOLDOWN_MS + 100);
    primaryHealthy = true;
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { sequence: 123456 },
      }),
    })) as unknown as typeof fetch;

    const recovered = await executeSorobanRpcWithFailover(
      async (_server, endpointUrl) => `served-by-${endpointUrl}`,
      { urls }
    );
    expect(recovered.endpointUrl).toBe(PRIMARY_RPC);
    expect(recovered.usedFallback).toBe(false);
    expect(primaryBreaker.getState()).toBe("CLOSED");
  });

  it("fails fast with CircuitOpenError when all configured RPC circuits are OPEN", async () => {
    const urls = [PRIMARY_RPC, SECONDARY_RPC];
    for (const url of urls) {
      const b = getEndpointCircuitBreaker(url);
      for (let i = 0; i < 5; i++) {
        b.recordFailure("outage");
      }
    }

    const opSpy = vi.fn();
    await expect(
      executeSorobanRpcWithFailover(opSpy, { urls })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(opSpy).not.toHaveBeenCalled();
  });

  it("wraps Horizon calls with a circuit breaker via executeHorizonWithCircuitBreaker", async () => {
    const horizonUrl = "https://horizon-testnet.stellar.org";
    const result = await executeHorizonWithCircuitBreaker(
      async (_server, url) => `horizon-ok:${url}`,
      { horizonUrl }
    );
    expect(result).toBe(`horizon-ok:${horizonUrl}`);
    expect(getEndpointCircuitBreaker(horizonUrl).getState()).toBe("CLOSED");
  });

  it("exposes rpcCircuitBreaker state in GET /api/health and marks health degraded when OPEN", async () => {
    const breaker = getEndpointCircuitBreaker(PRIMARY_RPC);
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure("RPC down");
    }
    expect(breaker.getState()).toBe("OPEN");

    vi.doMock("@/lib/prisma", () => ({
      default: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
    }));
    vi.doMock("@/lib/contracts", () => ({
      OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    }));
    vi.doMock("@/lib/metrics-middleware", () => ({
      withMetrics: (_name: string, handler: unknown) => handler,
    }));
    vi.doMock("@/lib/request-logging", () => ({
      withRequestLogging: (handler: unknown) => handler,
    }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);

    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.status).toBe("degraded");
    expect(body.data.rpcCircuitBreaker.state).toBe("OPEN");
    expect(body.data.rpcCircuitBreaker.tripsTotal).toBe(1);
    expect(body.data.rpcCircuitBreaker.endpoints[PRIMARY_RPC].state).toBe("OPEN");
    expect(body.data.rpcCircuitBreaker.endpoints[PRIMARY_RPC].tripCount).toBe(1);
  });
});
