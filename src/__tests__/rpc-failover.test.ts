// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock prisma for health check test
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

import {
  getWorkingRpcServer,
  getRpcFailoverState,
  resetRpcState,
  FALLBACK_RPC_URLS,
} from "@/lib/rpc-failover";
import { logger } from "@/lib/logger";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { GET as getHealth } from "@/app/api/health/route";
import prisma from "@/lib/prisma";

const originalFetch = global.fetch;

describe("Soroban RPC Failover and Health Signals", () => {
  const primaryUrl = FALLBACK_RPC_URLS.TESTNET[0];
  const fallbackUrl = FALLBACK_RPC_URLS.TESTNET[1];

  beforeEach(() => {
    vi.clearAllMocks();
    resetRpcState();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetRpcState();
  });

  it("reports initial default failover state correctly", () => {
    const state = getRpcFailoverState("TESTNET");
    expect(state.activeUrl).toBe(primaryUrl);
    expect(state.primaryUrl).toBe(primaryUrl);
    expect(state.isPrimary).toBe(true);
    expect(state.failoverCount).toBe(0);
    expect(state.endpoints[primaryUrl]).toBeDefined();
    expect(state.endpoints[primaryUrl].failureCount).toBe(0);
    expect(state.endpoints[fallbackUrl]).toBeDefined();
    expect(state.endpoints[fallbackUrl].failureCount).toBe(0);
  });

  it("serves primary endpoint when primary is healthy", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { status: "healthy" } }),
    } as Response);

    const server = await getWorkingRpcServer("TESTNET");
    expect(server.serverURL.toString()).toContain(new URL(primaryUrl).host);

    const state = getRpcFailoverState("TESTNET");
    expect(state.activeUrl).toBe(primaryUrl);
    expect(state.isPrimary).toBe(true);
    expect(state.failoverCount).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("fails over to fallback when primary fails and logs transition", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes(new URL(primaryUrl).host)) {
        return {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { status: "healthy" } }),
      } as Response;
    });

    const server = await getWorkingRpcServer("TESTNET");
    expect(server.serverURL.toString()).toContain(new URL(fallbackUrl).host);

    const state = getRpcFailoverState("TESTNET");
    expect(state.activeUrl).toBe(fallbackUrl);
    expect(state.isPrimary).toBe(false);
    expect(state.failoverCount).toBe(1);
    expect(state.endpoints[primaryUrl].failureCount).toBe(1);
    expect(state.endpoints[primaryUrl].lastFailureReason).toContain("HTTP 503");

    // Transition logged at warn level with endpoint names and failure reason
    expect(logger.warn).toHaveBeenCalledWith(
      "RPC endpoint failover transition",
      expect.objectContaining({
        from: primaryUrl,
        to: fallbackUrl,
        failoverCount: 1,
      })
    );
  });

  it("handles timeout error and logs specific reason", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes(new URL(primaryUrl).host)) {
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: 1 }),
      } as Response;
    });

    await getWorkingRpcServer("TESTNET");
    const state = getRpcFailoverState("TESTNET");
    expect(state.endpoints[primaryUrl].lastFailureReason).toContain("Probe timeout");
  });

  it("falls back to primary with error logged when all endpoints fail", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Error",
    } as Response);

    const server = await getWorkingRpcServer("TESTNET");
    expect(server.serverURL.toString()).toContain(new URL(primaryUrl).host);
    expect(logger.error).toHaveBeenCalledWith(
      "All RPC endpoints unavailable — falling back to primary",
      expect.anything()
    );
  });

  it("exposes RPC failover metrics in Prometheus /api/metrics route", async () => {
    // Simulate a failover first
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes(new URL(primaryUrl).host)) {
        return { ok: false, status: 502, statusText: "Bad Gateway" } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    await getWorkingRpcServer("TESTNET");

    const res = await getMetrics();
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("# HELP ophirpay_rpc_failovers_total");
    expect(text).toContain("ophirpay_rpc_failovers_total 1");
    expect(text).toContain("# HELP ophirpay_rpc_non_primary_active");
    expect(text).toContain("ophirpay_rpc_non_primary_active 1");
    expect(text).toContain("ophirpay_rpc_active_endpoint");
    expect(text).toContain("ophirpay_rpc_endpoint_failures_total");
    expect(text).toContain(primaryUrl);
  });

  it("exposes failover diagnostics in /api/health payload", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes(new URL(primaryUrl).host)) {
        return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    await getWorkingRpcServer("TESTNET");

    const req = new Request("http://localhost/api/health");
    const res = await getHealth(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    const rpcService = body.data.services.stellar.rpc;
    expect(rpcService).toBeDefined();
    expect(rpcService.activeEndpoint).toBe(fallbackUrl);
    expect(rpcService.isPrimary).toBe(false);
    expect(rpcService.failoverCount).toBe(1);
    expect(rpcService.endpoints[primaryUrl].failureCount).toBe(1);
  });
});
