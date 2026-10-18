import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RpcCircuitBreaker,
  RpcCircuitBreakerOpenError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerSnapshots,
} from "@/lib/rpc-circuit-breaker";
import {
  getProtectedRpcServer,
  executeRpcWithCircuitBreaker,
  getRpcHealthSnapshot,
} from "@/lib/stellar-rpc";
import {
  getRpcCircuitBreakerTripsTotal,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

describe("rpc-circuit-breaker (Issue #1421)", () => {
  const testEndpoint = "https://soroban-testnet.mock.stellar.org";
  const secondaryEndpoint = "https://rpc-futurenet.mock.stellar.org";

  beforeEach(() => {
    resetAllCircuitBreakers();
    resetMetricsForTest();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetAllCircuitBreakers();
    resetMetricsForTest();
    vi.useRealTimers();
  });

  describe("RpcCircuitBreaker state transitions", () => {
    it("initializes in CLOSED state with zero failures", () => {
      const breaker = new RpcCircuitBreaker(testEndpoint);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getCooldownRemainingMs()).toBe(0);
    });

    it("trips from CLOSED to OPEN after 5 consecutive failures", () => {
      const breaker = new RpcCircuitBreaker(testEndpoint, { failureThreshold: 5 });
      const initialTrips = getRpcCircuitBreakerTripsTotal();

      for (let i = 1; i <= 4; i++) {
        breaker.recordFailure(new Error(`Timeout ${i}`));
        expect(breaker.getState()).toBe("CLOSED");
        expect(breaker.canExecute()).toBe(true);
      }

      // 5th consecutive failure trips to OPEN
      breaker.recordFailure(new Error("Timeout 5"));
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.canExecute()).toBe(false);
      expect(breaker.getCooldownRemainingMs()).toBeGreaterThan(0);
      expect(getRpcCircuitBreakerTripsTotal()).toBe(initialTrips + 1);
    });

    it("resets consecutive failures count on success while in CLOSED state", () => {
      const breaker = new RpcCircuitBreaker(testEndpoint, { failureThreshold: 5 });
      breaker.recordFailure(new Error("Failure 1"));
      breaker.recordFailure(new Error("Failure 2"));
      breaker.recordSuccess();

      // Needs another 5 failures to trip
      for (let i = 1; i <= 4; i++) {
        breaker.recordFailure(new Error(`Failure ${i}`));
        expect(breaker.getState()).toBe("CLOSED");
      }
      breaker.recordFailure(new Error("Failure 5"));
      expect(breaker.getState()).toBe("OPEN");
    });

    it("fast-fails in OPEN state without executing the provided operation", async () => {
      const breaker = new RpcCircuitBreaker(testEndpoint, { failureThreshold: 2 });
      breaker.recordFailure(new Error("err 1"));
      breaker.recordFailure(new Error("err 2"));
      expect(breaker.getState()).toBe("OPEN");

      const spyOperation = vi.fn().mockResolvedValue("data");

      await expect(breaker.execute(spyOperation)).rejects.toThrow(RpcCircuitBreakerOpenError);
      expect(spyOperation).not.toHaveBeenCalled();
    });

    it("transitions to HALF_OPEN after cooldown elapses and recovers on successful probe", () => {
      vi.useFakeTimers();
      const breaker = new RpcCircuitBreaker(testEndpoint, {
        failureThreshold: 2,
        cooldownMs: 30_000,
      });

      breaker.recordFailure(new Error("err 1"));
      breaker.recordFailure(new Error("err 2"));
      expect(breaker.getState()).toBe("OPEN");

      // Advance by 15 seconds: still OPEN
      vi.advanceTimersByTime(15_000);
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.canExecute()).toBe(false);

      // Advance past 30 seconds: transitions to HALF_OPEN
      vi.advanceTimersByTime(16_000);
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.canExecute()).toBe(true);

      // Successful probe recovers to CLOSED
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.canExecute()).toBe(true);
    });

    it("re-trips to OPEN if a probe fails during HALF_OPEN", () => {
      vi.useFakeTimers();
      const breaker = new RpcCircuitBreaker(testEndpoint, {
        failureThreshold: 2,
        cooldownMs: 30_000,
      });

      breaker.recordFailure(new Error("err 1"));
      breaker.recordFailure(new Error("err 2"));
      expect(breaker.getState()).toBe("OPEN");

      vi.advanceTimersByTime(31_000);
      expect(breaker.getState()).toBe("HALF_OPEN");

      const tripCountBefore = getRpcCircuitBreakerTripsTotal();
      breaker.recordFailure(new Error("Probe probe failed"));

      expect(breaker.getState()).toBe("OPEN");
      expect(getRpcCircuitBreakerTripsTotal()).toBe(tripCountBefore + 1);
    });
  });

  describe("Lightweight probe queries (probeHealth)", () => {
    it("successfully completes probe with getLatestLedger and closes circuit", async () => {
      const breaker = new RpcCircuitBreaker(testEndpoint);

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { sequence: 12345 } }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const healthy = await breaker.probeHealth();
      expect(healthy).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        testEndpoint,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("getLatestLedger"),
        })
      );
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("falls back to getHealth if getLatestLedger returns non-ok", async () => {
      const breaker = new RpcCircuitBreaker(testEndpoint);

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      vi.stubGlobal("fetch", fetchSpy);

      const healthy = await breaker.probeHealth();
      expect(healthy).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("records failure when both probe methods fail or throw", async () => {
      const breaker = new RpcCircuitBreaker(testEndpoint, { failureThreshold: 1 });

      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network connection refused"));
      vi.stubGlobal("fetch", fetchSpy);

      const healthy = await breaker.probeHealth();
      expect(healthy).toBe(false);
      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("Secondary failover integration (src/lib/stellar-rpc.ts)", () => {
    it("fails over to secondary endpoint when primary is in OPEN state", async () => {
      const primaryBreaker = getCircuitBreaker(testEndpoint, { failureThreshold: 1 });
      primaryBreaker.recordFailure(new Error("Primary 500 error"));
      expect(primaryBreaker.getState()).toBe("OPEN");

      const secondaryBreaker = getCircuitBreaker(secondaryEndpoint);
      expect(secondaryBreaker.getState()).toBe("CLOSED");

      // Mock probe / server response
      const serverResult = await getProtectedRpcServer("TESTNET");
      expect(serverResult).toBeDefined();
      expect(serverResult.server).toBeDefined();
    });

    it("executes operation through executeRpcWithCircuitBreaker", async () => {
      const result = await executeRpcWithCircuitBreaker(async () => {
        return "stellar_operation_ok";
      });
      expect(result).toBe("stellar_operation_ok");
    });

    it("provides comprehensive health snapshot via getRpcHealthSnapshot", () => {
      const snapshot = getRpcHealthSnapshot("TESTNET");
      expect(snapshot.failover).toBeDefined();
      expect(snapshot.circuitBreakers).toBeDefined();
      expect(Object.keys(snapshot.circuitBreakers).length).toBeGreaterThan(0);
    });

    it("provides snapshots of all registered circuit breakers via getAllCircuitBreakerSnapshots", () => {
      getCircuitBreaker(testEndpoint);
      getCircuitBreaker(secondaryEndpoint);
      const all = getAllCircuitBreakerSnapshots();
      expect(all[testEndpoint]).toBeDefined();
      expect(all[secondaryEndpoint]).toBeDefined();
      expect(all[testEndpoint].state).toBe("CLOSED");
    });
  });
});
