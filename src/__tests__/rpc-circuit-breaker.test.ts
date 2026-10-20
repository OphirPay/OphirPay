// SPDX-License-Identifier: MIT

/**
 * Test Suite for Issue #1421:
 * Soroban RPC Circuit Breaker & Health Probe Fallback
 *
 * Verifies:
 * • Closed, Open, Half-Open state machine with 5-failure threshold and 30s cooldown.
 * • Rapid fail-fast rejection during Open state to prevent worker thread starvation.
 * • Automatic failover to secondary RPC endpoints when primary circuit is Open.
 * • Lightweight probe recovery (e.g. getLatestLedger) restoring Closed state.
 * • Integration with Prometheus counter `rpc_circuit_breaker_trips_total`.
 * • Exposition of circuit states via /api/health.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RpcCircuitBreaker,
  RpcCircuitOpenError,
  rpcCircuitBreaker,
  resetRpcCircuitBreaker,
} from "@/lib/rpc-circuit-breaker";
import {
  StellarRpcClient,
} from "@/lib/stellar-rpc";
import { incMetric } from "@/lib/metrics-counters";

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/metrics-counters", async () => {
  let counter = 0;
  return {
    incMetric: vi.fn((name: string) => {
      if (name === "rpc_circuit_breaker_trips_total") {
        counter++;
      }
    }),
    getCircuitBreakerTripsTotal: () => counter,
    resetTestMetrics: () => {
      counter = 0;
    },
  };
});

describe("RpcCircuitBreaker (Issue #1421)", () => {
  const PRIMARY = "https://soroban-testnet.stellar.org:443";
  let breaker: RpcCircuitBreaker;

  beforeEach(() => {
    vi.clearAllMocks();
    breaker = new RpcCircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 30_000,
      probeTimeoutMs: 3_000,
    });
  });

  afterEach(() => {
    breaker.reset();
    resetRpcCircuitBreaker();
  });

  it("initializes endpoint in CLOSED state with zero failures", () => {
    const snap = breaker.getEndpointSnapshot(PRIMARY);
    expect(snap.state).toBe("CLOSED");
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.isAvailable).toBe(true);
    expect(snap.trippedAt).toBeNull();
  });

  it("preserves CLOSED state and resets consecutive failures upon successful operations", async () => {
    // 2 isolated failures followed by a success
    try {
      await breaker.execute(async () => {
        throw new Error("HTTP 500");
      }, PRIMARY);
    } catch {}

    try {
      await breaker.execute(async () => {
        throw new Error("Timeout");
      }, PRIMARY);
    } catch {}

    expect(breaker.getEndpointSnapshot(PRIMARY).consecutiveFailures).toBe(2);

    // Now a success
    const result = await breaker.execute(async () => "ok", PRIMARY);
    expect(result).toBe("ok");

    const snap = breaker.getEndpointSnapshot(PRIMARY);
    expect(snap.state).toBe("CLOSED");
    expect(snap.consecutiveFailures).toBe(0);
    expect(snap.isAvailable).toBe(true);
  });

  it("trips to OPEN state after 5 consecutive failures and increments Prometheus counter", async () => {
    for (let i = 1; i <= 4; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error(`Failure ${i}`);
        }, PRIMARY)
      ).rejects.toThrow(`Failure ${i}`);

      const snap = breaker.getEndpointSnapshot(PRIMARY);
      expect(snap.state).toBe("CLOSED");
      expect(snap.consecutiveFailures).toBe(i);
    }

    // 5th failure trips the circuit
    await expect(
      breaker.execute(async () => {
        throw new Error("Failure 5 - Soroban RPC Outage");
      }, PRIMARY)
    ).rejects.toThrow("Failure 5 - Soroban RPC Outage");

    const snap = breaker.getEndpointSnapshot(PRIMARY);
    expect(snap.state).toBe("OPEN");
    expect(snap.consecutiveFailures).toBe(5);
    expect(snap.isAvailable).toBe(false);
    expect(snap.trippedAt).toBeGreaterThan(0);
    expect(incMetric).toHaveBeenCalledWith("rpc_circuit_breaker_trips_total");
  });

  it("rapidly rejects calls with RpcCircuitOpenError during OPEN state without executing the operation", async () => {
    const now = 1_000_000;
    // Trip to OPEN
    for (let i = 0; i < 5; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("500 Internal Error");
        }, PRIMARY, now)
      ).rejects.toThrow();
    }

    const opFn = vi.fn().mockResolvedValue("should_not_run");

    // Next call at now + 5s (still within 30s cooldown)
    await expect(breaker.execute(opFn, PRIMARY, now + 5_000)).rejects.toThrow(RpcCircuitOpenError);

    // Verify operation function was NOT executed (fail-fast, prevents thread starvation!)
    expect(opFn).not.toHaveBeenCalled();

    const snap = breaker.getEndpointSnapshot(PRIMARY, now + 5_000);
    expect(snap.state).toBe("OPEN");
    expect(snap.isAvailable).toBe(false);
  });

  it("transitions to HALF_OPEN after 30s cooldown and recovers to CLOSED upon successful probe", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("500 Outage");
        }, PRIMARY, now);
      } catch {}
    }

    expect(breaker.getEndpointSnapshot(PRIMARY, now).state).toBe("OPEN");

    // Advance beyond 30s cooldown (now + 31s)
    const afterCooldown = now + 31_000;
    expect(breaker.canExecute(PRIMARY, afterCooldown)).toBe(true);

    const halfOpenSnap = breaker.getEndpointSnapshot(PRIMARY, afterCooldown);
    expect(halfOpenSnap.state).toBe("HALF_OPEN");

    // Successful execution in HALF_OPEN restores circuit to CLOSED
    const result = await breaker.execute(async () => "recovered", PRIMARY, afterCooldown);
    expect(result).toBe("recovered");

    const closedSnap = breaker.getEndpointSnapshot(PRIMARY, afterCooldown);
    expect(closedSnap.state).toBe("CLOSED");
    expect(closedSnap.consecutiveFailures).toBe(0);
    expect(closedSnap.isAvailable).toBe(true);
  });

  it("immediately re-trips to OPEN when a trial probe fails in HALF_OPEN", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("500 Outage");
        }, PRIMARY, now);
      } catch {}
    }

    const afterCooldown = now + 31_000;
    expect(breaker.canExecute(PRIMARY, afterCooldown)).toBe(true);

    // Probe trial in HALF_OPEN fails
    await expect(
      breaker.execute(async () => {
        throw new Error("Upstream still down");
      }, PRIMARY, afterCooldown)
    ).rejects.toThrow("Upstream still down");

    // Should immediately re-trip to OPEN
    const snap = breaker.getEndpointSnapshot(PRIMARY, afterCooldown);
    expect(snap.state).toBe("OPEN");
    expect(snap.isAvailable).toBe(false);
  });

  it("recovers circuit via lightweight probeRecovery (e.g. getLatestLedger probe)", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("RPC error");
        }, PRIMARY, now);
      } catch {}
    }

    expect(breaker.getEndpointSnapshot(PRIMARY, now).state).toBe("OPEN");

    // Probe returns false -> recovery fails
    const failedRecovery = await breaker.probeRecovery(PRIMARY, async () => false, now + 31_000);
    expect(failedRecovery).toBe(false);
    expect(breaker.getEndpointSnapshot(PRIMARY, now + 31_000).state).toBe("OPEN");

    // Probe returns true -> recovery succeeds and restores CLOSED
    const okRecovery = await breaker.probeRecovery(PRIMARY, async () => true, now + 65_000);
    expect(okRecovery).toBe(true);
    expect(breaker.getEndpointSnapshot(PRIMARY, now + 65_000).state).toBe("CLOSED");
    expect(breaker.getEndpointSnapshot(PRIMARY, now + 65_000).consecutiveFailures).toBe(0);
  });
});

describe("StellarRpcClient Failover (Issue #1421)", () => {
  const PRIMARY = "https://soroban-testnet.stellar.org:443";
  const SECONDARY = "https://rpc-futurenet.stellar.org:443";
  let client: StellarRpcClient;

  beforeEach(() => {
    resetRpcCircuitBreaker();
    client = new StellarRpcClient();
  });

  afterEach(() => {
    resetRpcCircuitBreaker();
  });

  it("serves from primary endpoint when healthy without failover", async () => {
    const mockOp = vi.fn().mockResolvedValue({ status: "SUCCESS", ledger: 100 });

    const result = await client.executeWithFailover(mockOp, "TESTNET");

    expect(result.result).toEqual({ status: "SUCCESS", ledger: 100 });
    expect(result.endpoint).toBe(PRIMARY);
    expect(result.failedOver).toBe(false);
    expect(mockOp).toHaveBeenCalledTimes(1);
  });

  it("automatically fails over to secondary endpoint when primary encounters 5 failures and trips OPEN", async () => {
    // Force primary endpoint to fail 5 times while secondary succeeds
    for (let i = 0; i < 5; i++) {
      const res = await client.executeWithFailover(async (_server, endpoint) => {
        if (endpoint === PRIMARY) {
          throw new Error("HTTP 503 Service Unavailable");
        }
        return { status: "SUCCESS", fromFallback: true };
      }, "TESTNET");
      expect(res.endpoint).toBe(SECONDARY);
      expect(res.failedOver).toBe(true);
    }

    const primarySnap = rpcCircuitBreaker.getEndpointSnapshot(PRIMARY);
    expect(primarySnap.state).toBe("OPEN");

    // Now execute another call: primary circuit is OPEN, so executeWithFailover skips primary immediately
    const mockOp = vi.fn().mockImplementation(async (_server, endpoint) => {
      if (endpoint === PRIMARY) {
        throw new Error("Primary should not be invoked when OPEN!");
      }
      return { status: "SUCCESS", fromFallback: true };
    });

    const execution = await client.executeWithFailover(mockOp, "TESTNET");

    expect(execution.result).toEqual({ status: "SUCCESS", fromFallback: true });
    expect(execution.endpoint).toBe(SECONDARY);
    expect(execution.failedOver).toBe(true);
    // mockOp should only have been called for SECONDARY, not PRIMARY
    expect(mockOp).toHaveBeenCalledTimes(1);
  });

  it("probes endpoint recovery and resets circuit state", async () => {
    for (let i = 0; i < 5; i++) {
      rpcCircuitBreaker.recordFailure(PRIMARY, new Error("HTTP 500"));
    }

    expect(rpcCircuitBreaker.getEndpointSnapshot(PRIMARY).state).toBe("OPEN");

    // Probe recovery using mock getLatestLedger probe
    const recovered = await client.probeEndpointRecovery(PRIMARY, async () => true);
    expect(recovered).toBe(true);

    const restoredSnap = rpcCircuitBreaker.getEndpointSnapshot(PRIMARY);
    expect(restoredSnap.state).toBe("CLOSED");
    expect(restoredSnap.isAvailable).toBe(true);
  });

  it("generates correct health summary reporting degraded when primary circuit is OPEN", () => {
    // Initially ok
    let summary = client.getHealthSummary("TESTNET");
    expect(summary.status).toBe("ok");
    expect(summary.primary).toBe(PRIMARY);
    expect(summary.availableCount).toBeGreaterThanOrEqual(1);

    // Trip primary circuit
    for (let i = 0; i < 5; i++) {
      rpcCircuitBreaker.recordFailure(PRIMARY, new Error("Timeout"));
    }

    summary = client.getHealthSummary("TESTNET");
    expect(summary.status).toBe("degraded");
    expect(summary.endpoints[PRIMARY].state).toBe("OPEN");
  });
});
