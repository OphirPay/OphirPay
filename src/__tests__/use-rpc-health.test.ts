// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useRpcHealth,
  reportGlobalRpcMetric,
} from "@/hooks/useRpcHealth";

describe("useRpcHealth hook (issue #1295)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("initializes with non-degraded default state", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    expect(result.current.isDegraded).toBe(false);
    expect(result.current.activeEndpoint).toBeNull();
    expect(result.current.latencyMs).toBeNull();
    expect(result.current.statusReason).toBeNull();
    expect(result.current.errorRate).toBe(0);
  });

  it("marks degraded when latency exceeds 3000ms threshold", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    act(() => {
      result.current.reportRpcCall({
        endpoint: "https://soroban-testnet.stellar.org:443",
        latencyMs: 3500,
        status: 200,
      });
    });

    expect(result.current.isDegraded).toBe(true);
    expect(result.current.activeEndpoint).toBe("https://soroban-testnet.stellar.org:443");
    expect(result.current.latencyMs).toBe(3500);
    expect(result.current.statusReason).toContain("High response time");
  });

  it("marks degraded on HTTP 429 rate limit", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    act(() => {
      result.current.reportRpcCall({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 120,
        status: 429,
      });
    });

    expect(result.current.isDegraded).toBe(true);
    expect(result.current.statusReason).toContain("Rate limited (HTTP 429)");
  });

  it("marks degraded on HTTP 5xx server error", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    act(() => {
      result.current.reportRpcCall({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 400,
        status: 503,
      });
    });

    expect(result.current.isDegraded).toBe(true);
    expect(result.current.statusReason).toContain("Server error (HTTP 503)");
  });

  it("auto-clears degraded state when healthy responses resume", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    // First: degraded by high latency
    act(() => {
      result.current.reportRpcCall({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 4200,
        status: 200,
      });
    });
    expect(result.current.isDegraded).toBe(true);

    // Second: healthy response resumes
    act(() => {
      result.current.reportRpcCall({
        endpoint: "https://soroban.stellar.org:443",
        latencyMs: 150,
        status: 200,
      });
    });

    expect(result.current.isDegraded).toBe(false);
    expect(result.current.statusReason).toBeNull();
    expect(result.current.latencyMs).toBe(150);
  });

  it("receives global RPC metric broadcast via reportGlobalRpcMetric", () => {
    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    act(() => {
      reportGlobalRpcMetric({
        endpoint: "https://rpc-futurenet.stellar.org:443",
        latencyMs: 5100,
        status: 200,
      });
    });

    expect(result.current.isDegraded).toBe(true);
    expect(result.current.activeEndpoint).toBe("https://rpc-futurenet.stellar.org:443");
    expect(result.current.latencyMs).toBe(5100);
  });

  it("fetches /api/health and updates state accordingly", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          services: {
            stellar: {
              rpcUrl: "https://soroban-testnet.stellar.org:443",
              rpc: { status: "ok", latencyMs: 3600 },
            },
          },
          rpcFailover: {
            activeEndpoint: "https://soroban-testnet.stellar.org:443",
            degraded: false,
          },
        },
      }),
    });

    const { result } = renderHook(() => useRpcHealth({ enabled: false }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isDegraded).toBe(true);
    expect(result.current.latencyMs).toBe(3600);
    expect(result.current.activeEndpoint).toBe("https://soroban-testnet.stellar.org:443");
    expect(result.current.statusReason).toContain("High response time");
  });

  it("allows user to manually dismiss degraded banner state", () => {
    const { result } = renderHook(() =>
      useRpcHealth({
        enabled: false,
        initialState: {
          isDegraded: true,
          statusReason: "Manual error",
        },
      })
    );

    expect(result.current.isDegraded).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isDegraded).toBe(false);
    expect(result.current.statusReason).toBeNull();
  });
});
