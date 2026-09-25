// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The metrics route falls back to API-key auth, which imports Prisma. These
// tests only exercise the static METRICS_TOKEN path, so stub the module.
vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

// The health route imports Prisma and the contract registry; stub both so the
// suite stays free of a database client.
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(async () => [{ 1: 1 }]),
  },
}));

vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import {
  getWorkingRpcServer,
  getRpcFailoverSnapshot,
  getAllRpcFailoverSnapshots,
  resetRpcState,
} from "@/lib/rpc-failover";
import { logger } from "@/lib/logger";
import { GET as metricsGET } from "@/app/api/metrics/route";
import { GET as healthGET } from "@/app/api/health/route";

const PRIMARY_PUBLIC = "https://soroban.stellar.org:443";
const FALLBACK_PUBLIC = "https://mainnet.soroban.rpc.pulse.so:443";

const METRICS_TOKEN = "test-metrics-token-0123456789abcdef";

const originalFetch = global.fetch;

function authenticatedMetricsRequest(): Request {
  return new Request("http://localhost/api/metrics", {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
}

describe("RPC failover state", () => {
  beforeEach(() => {
    resetRpcState();
    global.fetch = vi.fn();
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.METRICS_TOKEN;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports the primary as active before any probe has run", () => {
    const snapshot = getRpcFailoverSnapshot("PUBLIC");
    expect(snapshot.primaryUrl).toBe(PRIMARY_PUBLIC);
    expect(snapshot.activeUrl).toBe(PRIMARY_PUBLIC);
    expect(snapshot.onPrimary).toBe(true);
    expect(snapshot.failoverCount).toBe(0);
    expect(snapshot.lastTransitionAt).toBeNull();
    expect(snapshot.endpoints).toHaveLength(2);
    expect(snapshot.endpoints[0]).toMatchObject({
      url: PRIMARY_PUBLIC,
      isPrimary: true,
      isActive: true,
      lastFailureReason: null,
    });
  });

  it("covers every configured network in getAllRpcFailoverSnapshots", () => {
    const networks = getAllRpcFailoverSnapshots().map((s) => s.network);
    expect(networks).toEqual(["TESTNET", "PUBLIC"]);
  });

  it("fails over to the fallback, counts the transition, and logs both endpoint names with the reason", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(PRIMARY_PUBLIC)) {
        return { ok: false, status: 503 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    const server = await getWorkingRpcServer("PUBLIC");
    expect(server.serverURL.toString()).toContain(FALLBACK_PUBLIC);

    const snapshot = getRpcFailoverSnapshot("PUBLIC");
    expect(snapshot.activeUrl).toBe(FALLBACK_PUBLIC);
    expect(snapshot.onPrimary).toBe(false);
    expect(snapshot.failoverCount).toBe(1);
    expect(snapshot.lastTransitionAt).not.toBeNull();

    const primary = snapshot.endpoints.find((e) => e.url === PRIMARY_PUBLIC);
    expect(primary?.lastFailureReason).toBe("health check returned HTTP 503");
    expect(primary?.lastFailureAt).not.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith(
      "RPC endpoint transition",
      expect.objectContaining({
        network: "PUBLIC",
        from: PRIMARY_PUBLIC,
        to: FALLBACK_PUBLIC,
        reason: "health check returned HTTP 503",
      })
    );
  });

  it("records a timeout reason when the probe aborts", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(PRIMARY_PUBLIC)) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return { ok: true, status: 200 } as Response;
    });

    await getWorkingRpcServer("PUBLIC");

    const primary = getRpcFailoverSnapshot("PUBLIC").endpoints.find(
      (e) => e.url === PRIMARY_PUBLIC
    );
    expect(primary?.lastFailureReason).toBe(
      "health check timed out after 3000ms"
    );
  });

  it("recovers to the primary once it is healthy again and counts the return transition", async () => {
    vi.useFakeTimers();

    // Primary down → fail over.
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).startsWith(PRIMARY_PUBLIC)
        ? ({ ok: false, status: 500 } as Response)
        : ({ ok: true, status: 200 } as Response)
    );
    await getWorkingRpcServer("PUBLIC");
    expect(getRpcFailoverSnapshot("PUBLIC").activeUrl).toBe(FALLBACK_PUBLIC);

    // Move past the cache TTL and the circuit-breaker cooldown, primary back.
    vi.setSystemTime(Date.now() + 61_000);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const server = await getWorkingRpcServer("PUBLIC");
    expect(server.serverURL.toString()).toContain(PRIMARY_PUBLIC);

    const snapshot = getRpcFailoverSnapshot("PUBLIC");
    expect(snapshot.activeUrl).toBe(PRIMARY_PUBLIC);
    expect(snapshot.onPrimary).toBe(true);
    expect(snapshot.failoverCount).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "RPC endpoint transition",
      expect.objectContaining({ from: FALLBACK_PUBLIC, to: PRIMARY_PUBLIC })
    );
  });

  it("falls back to the primary with an error log when every endpoint is down", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("connection refused"));

    const server = await getWorkingRpcServer("PUBLIC");
    expect(server.serverURL.toString()).toContain(PRIMARY_PUBLIC);
    expect(logger.error).toHaveBeenCalledWith(
      "All RPC endpoints unavailable — falling back to primary"
    );

    const snapshot = getRpcFailoverSnapshot("PUBLIC");
    // First selection, not a transition away from a previous endpoint.
    expect(snapshot.failoverCount).toBe(0);
    for (const endpoint of snapshot.endpoints) {
      expect(endpoint.lastFailureReason).toBe(
        "health check failed: connection refused"
      );
    }
  });

  it("keeps serving the cached endpoint without re-probing inside the TTL", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    await getWorkingRpcServer("PUBLIC");
    const callsAfterFirst = vi.mocked(global.fetch).mock.calls.length;

    await getWorkingRpcServer("PUBLIC");
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callsAfterFirst);
    expect(getRpcFailoverSnapshot("PUBLIC").failoverCount).toBe(0);
  });

  it("exposes failover state on /api/metrics", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).startsWith(PRIMARY_PUBLIC)
        ? ({ ok: false, status: 503 } as Response)
        : ({ ok: true, status: 200 } as Response)
    );
    await getWorkingRpcServer("PUBLIC");

    const res = await metricsGET(authenticatedMetricsRequest());
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("# TYPE ophirpay_rpc_failovers_total counter");
    expect(text).toContain('ophirpay_rpc_failovers_total{network="PUBLIC"} 1');
    expect(text).toContain('ophirpay_rpc_failovers_total{network="TESTNET"} 0');
    expect(text).toContain("# TYPE ophirpay_rpc_on_primary_endpoint gauge");
    expect(text).toContain(
      'ophirpay_rpc_on_primary_endpoint{network="PUBLIC"} 0'
    );
    expect(text).toContain(
      `ophirpay_rpc_endpoint_active{network="PUBLIC",endpoint="${FALLBACK_PUBLIC}",is_primary="false"} 1`
    );
    expect(text).toContain(
      `ophirpay_rpc_endpoint_active{network="PUBLIC",endpoint="${PRIMARY_PUBLIC}",is_primary="true"} 0`
    );
    expect(text).toContain(
      "# TYPE ophirpay_rpc_endpoint_last_failure_timestamp_seconds gauge"
    );
    expect(text).toContain(
      `ophirpay_rpc_endpoint_last_failure_info{network="PUBLIC",endpoint="${PRIMARY_PUBLIC}",reason="health check returned HTTP 503"} 1`
    );
  });

  it("exposes failover state in the /api/health payload", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith(PRIMARY_PUBLIC)) {
        return { ok: false, status: 503 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });
    await getWorkingRpcServer("PUBLIC");

    const res = await healthGET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The health route reports the network the app is configured for; the
    // failover snapshot shape is what matters here.
    const failover = body.data.services.stellar.failover;
    expect(failover).toBeDefined();
    const primary = failover.endpoints.find(
      (e: { isPrimary: boolean }) => e.isPrimary
    );
    const active = failover.endpoints.find(
      (e: { isActive: boolean }) => e.isActive
    );
    expect(failover.primaryRpcUrl).toBe(primary.url);
    expect(failover.activeRpcUrl).toBe(active.url);
    expect(failover.onPrimary).toBe(active.url === primary.url);
    expect(typeof failover.failoverCount).toBe("number");
    expect(failover).toHaveProperty("lastTransitionAt");
    expect(failover.endpoints[0]).toHaveProperty("lastFailureReason");
    expect(failover.endpoints[0]).toHaveProperty("lastFailureAt");
  });

  it("resets failover state with resetRpcState", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).startsWith(PRIMARY_PUBLIC)
        ? ({ ok: false, status: 503 } as Response)
        : ({ ok: true, status: 200 } as Response)
    );
    await getWorkingRpcServer("PUBLIC");
    expect(getRpcFailoverSnapshot("PUBLIC").failoverCount).toBe(1);

    resetRpcState();
    const snapshot = getRpcFailoverSnapshot("PUBLIC");
    expect(snapshot.failoverCount).toBe(0);
    expect(snapshot.activeUrl).toBe(PRIMARY_PUBLIC);
    expect(
      snapshot.endpoints.every((e) => e.lastFailureReason === null)
    ).toBe(true);
  });
});
