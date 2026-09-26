// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getWorkingRpcServer,
  getRpcFailoverState,
  getRpcUrls,
  resetRpcState,
} from "@/lib/rpc-failover";
import { getMetricsSnapshot, resetMetricsForTest } from "@/lib/metrics-counters";

const originalFetch = global.fetch;

describe("rpc-failover", () => {
  beforeEach(() => {
    resetRpcState();
    resetMetricsForTest();
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reports initial failover state correctly", () => {
    const state = getRpcFailoverState("PUBLIC");
    const urls = getRpcUrls("PUBLIC");

    expect(state.primaryEndpoint).toBe(urls[0]);
    expect(state.activeEndpoint).toBe(urls[0]);
    expect(state.onFallback).toBe(false);
    expect(state.failoverCount).toBe(0);
    expect(state.lastFailures).toEqual({});
  });

  it("connects to primary endpoint when healthy", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { status: "healthy" } }),
    } as Response);

    const server = await getWorkingRpcServer("PUBLIC");
    const urls = getRpcUrls("PUBLIC");

    expect(server.serverURL.toString()).toContain(new URL(urls[0]).host);
    const state = getRpcFailoverState("PUBLIC");
    expect(state.activeEndpoint).toBe(urls[0]);
    expect(state.onFallback).toBe(false);
    expect(state.failoverCount).toBe(0);
  });

  it("fails over to secondary endpoint when primary fails and increments metrics", async () => {
    const urls = getRpcUrls("PUBLIC");
    expect(urls.length).toBeGreaterThanOrEqual(2);

    // Primary fails, secondary succeeds
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: "healthy" } }),
      } as Response);

    const server = await getWorkingRpcServer("PUBLIC");

    expect(server.serverURL.toString()).toContain(new URL(urls[1]).host);

    const state = getRpcFailoverState("PUBLIC");
    expect(state.activeEndpoint).toBe(urls[1]);
    expect(state.onFallback).toBe(true);
    expect(state.failoverCount).toBe(1);
    expect(state.lastFailures[urls[0]]).toBeDefined();
    expect(state.lastFailures[urls[0]].reason).toBe("Connection refused");

    const metrics = getMetricsSnapshot();
    expect(metrics.rpc_failovers_total).toBe(1);
  });

  it("resets failover state cleanly via resetRpcState", async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: "healthy" } }),
      } as Response);

    await getWorkingRpcServer("PUBLIC");
    let state = getRpcFailoverState("PUBLIC");
    expect(state.failoverCount).toBe(1);
    expect(state.onFallback).toBe(true);

    resetRpcState();

    state = getRpcFailoverState("PUBLIC");
    expect(state.failoverCount).toBe(0);
    expect(state.onFallback).toBe(false);
    expect(state.lastFailures).toEqual({});
  });

  it("falls back to primary when all endpoints fail", async () => {
    const urls = getRpcUrls("PUBLIC");
    vi.mocked(global.fetch).mockRejectedValue(new Error("Global outage"));

    const server = await getWorkingRpcServer("PUBLIC");

    expect(server.serverURL.toString()).toContain(new URL(urls[0]).host);
    const state = getRpcFailoverState("PUBLIC");
    expect(state.activeEndpoint).toBe(urls[0]);
    expect(state.onFallback).toBe(false);
  });
});
