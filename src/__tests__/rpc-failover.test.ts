// SPDX-License-Identifier: MIT

// RPC failover observability (issue #820): active endpoint tracking,
// transition counting with named logging, and per-endpoint failure reasons.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWorkingRpcServer,
  getRpcFailoverState,
  getPrimaryRpcUrl,
  resetRpcState,
} from "@/lib/rpc-failover";
import { logger } from "@/lib/logger";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";

const originalFetch = globalThis.fetch;
// PUBLIC has two configured endpoints, so failover is exercisable.
const PRIMARY = "https://soroban.stellar.org:443";
const FALLBACK = "https://mainnet.soroban.rpc.pulse.so:443";

function mockProbes(handler: (url: string) => { ok: boolean } | Error) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    const outcome = handler(url);
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve({ ok: outcome.ok });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetRpcState();
  resetMetricsForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getWorkingRpcServer failover state", () => {
  it("serves primary healthy with no failover recorded", async () => {
    mockProbes(() => ({ ok: true }));

    await getWorkingRpcServer("PUBLIC");
    const state = getRpcFailoverState("PUBLIC");

    expect(state.activeUrl).toBe(PRIMARY);
    expect(state.primaryUrl).toBe(getPrimaryRpcUrl("PUBLIC"));
    expect(state.onFallback).toBe(false);
    expect(state.failovers).toBe(0);
    expect(getMetricsSnapshot().rpc_failovers_total).toBe(0);
  });

  it("fails over with names, reason and metric on primary outage", async () => {
    mockProbes((url) =>
      url === PRIMARY ? { ok: false } : { ok: true }
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await getWorkingRpcServer("PUBLIC");

    const state = getRpcFailoverState("PUBLIC");
    expect(state.activeUrl).toBe(FALLBACK);
    expect(state.onFallback).toBe(true);
    expect(state.failovers).toBe(1);
    expect(state.lastFailureByUrl[PRIMARY]).toBe("probe unhealthy");
    expect(state.lastTransitionAt).not.toBeNull();
    expect(getMetricsSnapshot().rpc_failovers_total).toBe(1);

    const transitionLog = warnSpy.mock.calls.find(([msg]) =>
      String(msg).includes("RPC endpoint failover")
    );
    expect(transitionLog).toBeDefined();
    expect(transitionLog?.[1]).toMatchObject({ from: "(none)", to: FALLBACK });
  });

  it("records unreachable distinctly from unhealthy", async () => {
    mockProbes((url) => {
      if (url === PRIMARY) throw new Error("socket hang up");
      return { ok: true };
    });

    await getWorkingRpcServer("PUBLIC");
    const state = getRpcFailoverState("PUBLIC");

    expect(state.onFallback).toBe(true);
    expect(state.lastFailureByUrl[PRIMARY]).toBe("probe unreachable");
  });
});
