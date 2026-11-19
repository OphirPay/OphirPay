// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useRpcHealth,
  parseRpcHealthPayload,
  formatRpcEndpoint,
  RPC_HEALTH_LATENCY_THRESHOLD_MS,
} from "@/hooks/useRpcHealth";

const PRIMARY = "https://soroban-testnet.stellar.org:443";
const FALLBACK = "https://rpc-futurenet.stellar.org:443";

function healthPayload({
  rpcStatus = "ok",
  latencyMs = 120,
  activeEndpoint = PRIMARY,
  usingFallback = false,
}: {
  rpcStatus?: "ok" | "error";
  latencyMs?: number | null;
  activeEndpoint?: string;
  usingFallback?: boolean;
} = {}) {
  return {
    success: true,
    data: {
      status: "ok",
      services: {
        stellar: {
          network: "TESTNET",
          rpcUrl: PRIMARY,
          rpc: { status: rpcStatus, latencyMs },
        },
      },
      rpcFailover: {
        activeEndpoint,
        primaryEndpoint: PRIMARY,
        activeProviderName: new URL(activeEndpoint).host,
        usingFallback,
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseRpcHealthPayload", () => {
  it("marks an ok probe with a finite latency as healthy", () => {
    const probe = parseRpcHealthPayload(healthPayload({ latencyMs: 87 }));
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBe(87);
    expect(probe.activeEndpoint).toBe(PRIMARY);
    expect(probe.activeProviderName).toBe("soroban-testnet.stellar.org");
    expect(probe.usingFallback).toBe(false);
  });

  it("marks an RPC error as failed", () => {
    const probe = parseRpcHealthPayload(healthPayload({ rpcStatus: "error" }));
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/failed/i);
  });

  it("surfaces the failover endpoint and provider", () => {
    const probe = parseRpcHealthPayload(
      healthPayload({ activeEndpoint: FALLBACK, usingFallback: true })
    );
    expect(probe.activeEndpoint).toBe(FALLBACK);
    expect(probe.activeProviderName).toBe("rpc-futurenet.stellar.org");
    expect(probe.usingFallback).toBe(true);
  });

  it("never throws on a malformed body", () => {
    expect(parseRpcHealthPayload(null).ok).toBe(false);
    expect(parseRpcHealthPayload("nope").ok).toBe(false);
    expect(parseRpcHealthPayload({ success: true }).ok).toBe(false);
  });
});

describe("formatRpcEndpoint", () => {
  it("renders the host of a URL and tolerates non-URL values", () => {
    expect(formatRpcEndpoint(PRIMARY)).toBe("soroban-testnet.stellar.org");
    expect(formatRpcEndpoint("not a url")).toBe("not a url");
    expect(formatRpcEndpoint(null)).toBe("");
  });
});

describe("useRpcHealth", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a healthy snapshot after the first probe", async () => {
    fetchMock.mockResolvedValue(jsonResponse(healthPayload({ latencyMs: 250 })));

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("healthy"));
    expect(result.current.latencyMs).toBe(250);
    expect(result.current.activeProviderName).toBe(
      "soroban-testnet.stellar.org"
    );
    expect(result.current.errorRate).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it("degrades when latency exceeds the 3000ms threshold", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(healthPayload({ latencyMs: RPC_HEALTH_LATENCY_THRESHOLD_MS + 1 }))
    );

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("degraded"));
    expect(result.current.latencyMs).toBe(3001);
    expect(result.current.error).toMatch(/latency/i);
  });

  it("degrades on a 429 response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false }, 429));

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("degraded"));
    expect(result.current.error).toBe("HTTP 429");
    expect(result.current.consecutiveFailures).toBe(1);
  });

  it("degrades on a 5xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false }, 503));

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("degraded"));
    expect(result.current.error).toBe("HTTP 503");
  });

  it("degrades when the health request throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("degraded"));
    expect(result.current.error).toBe("network down");
    expect(result.current.errorRate).toBeGreaterThan(0);
  });

  it("clears the degraded state as soon as a healthy probe resumes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false }, 503))
      .mockResolvedValue(jsonResponse(healthPayload({ latencyMs: 90 })));

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("degraded"));
    expect(result.current.consecutiveFailures).toBe(1);

    await result.current.refresh();

    await waitFor(() => expect(result.current.status).toBe("healthy"));
    expect(result.current.consecutiveFailures).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("does not poll when disabled", async () => {
    renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, enabled: false, pollIntervalMs: 10 })
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the failover provider alongside the healthy state", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        healthPayload({
          activeEndpoint: FALLBACK,
          usingFallback: true,
          latencyMs: 400,
        })
      )
    );

    const { result } = renderHook(() =>
      useRpcHealth({ fetcher: fetchMock, pollIntervalMs: 1_000_000 })
    );

    await waitFor(() => expect(result.current.status).toBe("healthy"));
    expect(result.current.usingFallback).toBe(true);
    expect(result.current.activeProviderName).toBe("rpc-futurenet.stellar.org");
  });
});
