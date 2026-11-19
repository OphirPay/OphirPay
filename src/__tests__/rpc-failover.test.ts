// SPDX-License-Identifier: MIT

/**
 * Issue #820 — RPC failover state must be observable.
 *
 * Acceptance criteria covered here:
 *   • The active RPC endpoint and failover count are visible through
 *     `getRpcFailoverState()` (surfaced by /api/health and /api/metrics).
 *   • A transition between endpoints is logged with both names and the
 *     failure reason.
 *   • The degraded condition (non-primary endpoint beyond the threshold) is
 *     reported, which is what the `RpcFailoverDegraded` alert rule fires on.
 *   • `resetRpcState` clears every tracked value so tests are independent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

// Track module state with a controllable clock.
let nowMs = 1_000_000;
const NOW = () => nowMs;

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      // The failover module only constructs the server; tests assert on the
      // tracked endpoint state rather than SDK internals.
      constructor(public readonly endpointUrl: string) {}
    },
  },
}));

import { logger } from "@/lib/logger";
import {
  getWorkingRpcServer,
  getRpcFailoverState,
  getRpcUrls,
  isRpcFailoverDegraded,
  resetRpcState,
  RPC_FAILOVER_DEGRADED_AFTER_MS,
} from "@/lib/rpc-failover";

function mockProbeResults(responses: Record<string, boolean | Error>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const outcome = responses[url];
    if (outcome instanceof Error) throw outcome;
    if (outcome) return { ok: true, status: 200 } as Response;
    return { ok: false, status: 503 } as Response;
  }) as unknown as typeof fetch;
}

const TESTNET_URLS = getRpcUrls("TESTNET");
const PRIMARY = TESTNET_URLS[0];
const FALLBACK = TESTNET_URLS[1] ?? PRIMARY;

/** Advance the fake clock; the module reads Date.now() on every call. */
function advanceMs(ms: number): void {
  nowMs += ms;
  vi.setSystemTime(nowMs);
}

describe("RPC failover state (issue #820)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRpcState();
    vi.useFakeTimers();
    vi.setSystemTime(NOW());
    // One healthy primary plus one healthy fallback for the default network.
    mockProbeResults({
      [PRIMARY]: true,
      [FALLBACK]: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    resetRpcState();
  });

  it("reports the active endpoint and no failovers while primary is healthy", async () => {
    await getWorkingRpcServer("TESTNET");

    const state = getRpcFailoverState();
    expect(state.activeEndpoint).toBe(PRIMARY);
    expect(state.primaryEndpoint).toBe(PRIMARY);
    expect(state.usingFallback).toBe(false);
    expect(state.failoverCount).toBe(0);
    expect(state.recoveryCount).toBe(0);
  });

  it("counts a failover and logs the transition with both endpoints and the reason", async () => {
    // Primary fails its probe; fallback is healthy.
    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });

    const server = await getWorkingRpcServer("TESTNET");
    expect((server as unknown as { endpointUrl: string }).endpointUrl).toBe(FALLBACK);

    const state = getRpcFailoverState();
    expect(state.activeEndpoint).toBe(FALLBACK);
    expect(state.usingFallback).toBe(true);
    expect(state.failoverCount).toBe(1);
    expect(state.lastFailureReasons[PRIMARY]).toBe("HTTP 503");

    // First activation happens before anything was serving, so the previous
    // endpoint is reported as "(none)" — but the failover is still counted.
    expect(logger.warn).toHaveBeenCalledWith(
      "RPC failover: switching endpoints",
      expect.objectContaining({
        from: "(none)",
        to: FALLBACK,
        reason: expect.any(String),
      }),
    );
  });

  it("counts a recovery when the primary comes back and logs both endpoints", async () => {
    // First call: primary down → fail over.
    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    expect(getRpcFailoverState().failoverCount).toBe(1);

    // Move past the cache TTL and the circuit cooldown, restore the primary.
    advanceMs(120_000);
    mockProbeResults({ [PRIMARY]: true, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");

    const state = getRpcFailoverState();
    expect(state.activeEndpoint).toBe(PRIMARY);
    expect(state.usingFallback).toBe(false);
    expect(state.recoveryCount).toBe(1);
    expect(state.failoverCount).toBe(1);
    expect(state.lastTransitionAt).not.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith(
      "RPC failover: recovered to primary endpoint",
      expect.objectContaining({
        from: FALLBACK,
        to: PRIMARY,
      }),
    );
  });

  it("tracks the duration of the current fallback episode", async () => {
    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    expect(getRpcFailoverState().currentFallbackDurationMs).toBe(0);

    advanceMs(30_000);
    // Cache is still fresh — state durations keep advancing with the clock.
    expect(getRpcFailoverState().currentFallbackDurationMs).toBe(30_000);
    expect(getRpcFailoverState().longestFallbackDurationMs).toBe(0); // not closed yet

    // Recover: the episode closes and the longest duration is recorded.
    advanceMs(30_000);
    mockProbeResults({ [PRIMARY]: true, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    const state = getRpcFailoverState();
    expect(state.currentFallbackDurationMs).toBe(0);
    expect(state.longestFallbackDurationMs).toBe(60_000);
  });

  it("reports degraded only after the non-primary endpoint exceeds the threshold", async () => {
    expect(isRpcFailoverDegraded()).toBe(false);

    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    expect(isRpcFailoverDegraded()).toBe(false);

    advanceMs(RPC_FAILOVER_DEGRADED_AFTER_MS + 1_000);
    expect(isRpcFailoverDegraded()).toBe(true);

    const state = getRpcFailoverState();
    expect(state.usingFallback).toBe(true);
    expect(state.currentFallbackDurationMs).toBeGreaterThan(RPC_FAILOVER_DEGRADED_AFTER_MS);
  });

  it("degraded state marks the health payload degraded and is surfaced in the response", async () => {
    // Drive the failover module into a long-running fallback episode.
    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    advanceMs(RPC_FAILOVER_DEGRADED_AFTER_MS + 5_000);

    // Import the health route with its heavy dependencies mocked, but WITHOUT
    // resetting the module registry: the route must resolve the very same
    // (stateful) rpc-failover module instance whose state we drove above.
    vi.doMock("@/lib/prisma", () => ({
      default: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
    }));
    vi.doMock("@/lib/contracts", () => ({
      OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    }));
    vi.doMock("@/lib/stellar", () => ({
      STELLAR_NETWORK: "TESTNET",
      SOROBAN_RPC_URL: PRIMARY,
      HORIZON_URL: "https://horizon-testnet.stellar.org",
    }));
    vi.doMock("@/lib/metrics-middleware", () => ({
      withMetrics: (_name: string, handler: unknown) => handler,
    }));
    vi.doMock("@/lib/request-logging", () => ({
      withRequestLogging: (handler: unknown) => handler,
    }));
    const { GET } = await import("@/app/api/health/route");

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("degraded");
    expect(body.data.rpcFailover.usingFallback).toBe(true);
    expect(body.data.rpcFailover.degraded).toBe(true);
    expect(body.data.rpcFailover.activeEndpoint).toBe(FALLBACK);
    expect(body.data.rpcFailover.failoverCount).toBe(1);
    expect(body.data.rpcFailover.currentFallbackDurationMs).toBeGreaterThan(
      RPC_FAILOVER_DEGRADED_AFTER_MS,
    );
  });

  it("resetRpcState clears failover tracking", async () => {
    mockProbeResults({ [PRIMARY]: false, [FALLBACK]: true });
    await getWorkingRpcServer("TESTNET");
    expect(getRpcFailoverState().failoverCount).toBe(1);

    resetRpcState();
    const state = getRpcFailoverState();
    expect(state.activeEndpoint).toBeNull();
    expect(state.failoverCount).toBe(0);
    expect(state.recoveryCount).toBe(0);
    expect(state.lastFailureReasons).toEqual({});
    expect(state.lastTransitionAt).toBeNull();
    expect(isRpcFailoverDegraded()).toBe(false);
  });

  it("captures timeout reasons from aborted probes", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === PRIMARY) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    await getWorkingRpcServer("TESTNET");
    expect(getRpcFailoverState().lastFailureReasons[PRIMARY]).toBe("timeout");
  });
});
