"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback } from "react";
import { getRpcFailoverState, getRpcUrls } from "@/lib/rpc-failover";

export const DEGRADED_LATENCY_THRESHOLD_MS = 3_000;

export interface RpcHealthStatus {
  /** True when latency exceeds 3000ms, HTTP 429/5xx occurs, or fallback RPC is active. */
  degraded: boolean;
  /** Currently active Soroban RPC provider URL. */
  activeEndpoint: string;
  /** Latest measured RPC latency in milliseconds (null before first probe). */
  latencyMs: number | null;
  /** Last HTTP status code from the health check or RPC probe. */
  httpStatus: number | null;
  /** True when serving from a non-primary failover RPC provider. */
  usingFallback: boolean;
  /** Human-readable degradation reason, or null when healthy. */
  reason: string | null;
}

export interface EvaluateRpcHealthInput {
  latencyMs: number | null;
  httpStatus: number | null;
  activeEndpoint?: string | null;
  usingFallback?: boolean;
  serviceStatus?: "ok" | "degraded" | "down" | string | null;
  thresholdMs?: number;
}

/**
 * Pure evaluator for RPC health telemetry (#1295).
 */
export function evaluateRpcHealthSnapshot(
  input: EvaluateRpcHealthInput,
): RpcHealthStatus {
  const thresholdMs = input.thresholdMs ?? DEGRADED_LATENCY_THRESHOLD_MS;
  const defaultUrl = getRpcUrls("TESTNET")[0] ?? "https://soroban-testnet.stellar.org:443";
  const activeEndpoint = input.activeEndpoint || defaultUrl;
  const usingFallback = Boolean(input.usingFallback);
  const { latencyMs, httpStatus, serviceStatus } = input;

  if (httpStatus === 429) {
    return {
      degraded: true,
      activeEndpoint,
      latencyMs,
      httpStatus,
      usingFallback,
      reason: "RPC rate limit reached (HTTP 429)",
    };
  }

  if (httpStatus !== null && httpStatus >= 500) {
    return {
      degraded: true,
      activeEndpoint,
      latencyMs,
      httpStatus,
      usingFallback,
      reason: `RPC endpoint error (HTTP ${httpStatus})`,
    };
  }

  if (serviceStatus === "degraded" || serviceStatus === "down") {
    return {
      degraded: true,
      activeEndpoint,
      latencyMs,
      httpStatus,
      usingFallback,
      reason: `Stellar RPC network is ${serviceStatus}`,
    };
  }

  if (latencyMs !== null && latencyMs > thresholdMs) {
    return {
      degraded: true,
      activeEndpoint,
      latencyMs,
      httpStatus,
      usingFallback,
      reason: `High RPC latency (${Math.round(latencyMs)}ms)`,
    };
  }

  if (usingFallback) {
    return {
      degraded: true,
      activeEndpoint,
      latencyMs,
      httpStatus,
      usingFallback,
      reason: "Failover RPC provider active",
    };
  }

  return {
    degraded: false,
    activeEndpoint,
    latencyMs,
    httpStatus,
    usingFallback: false,
    reason: null,
  };
}

export interface UseRpcHealthOptions {
  /** Poll interval in milliseconds (defaults to 30_000; set 0 to disable polling). */
  pollIntervalMs?: number;
  /** Latency threshold in milliseconds (defaults to 3_000). */
  thresholdMs?: number;
  /** Custom health endpoint URL (defaults to `/api/health`). */
  healthUrl?: string;
  /** Injectable fetch implementation for deterministic testing. */
  fetchImpl?: typeof fetch;
  /** Initial state override for controlled rendering / tests. */
  initialState?: RpcHealthStatus;
}

/**
 * Monitor Soroban / Horizon RPC response latency, error rates, and failover
 * provider status (#1295).
 */
export function useRpcHealth(options: UseRpcHealthOptions = {}): RpcHealthStatus & {
  refresh: () => Promise<void>;
} {
  const {
    pollIntervalMs = 30_000,
    thresholdMs = DEGRADED_LATENCY_THRESHOLD_MS,
    healthUrl = "/api/health",
    fetchImpl,
    initialState,
  } = options;

  const [status, setStatus] = useState<RpcHealthStatus>(() => {
    if (initialState) return initialState;
    const failover = getRpcFailoverState();
    return evaluateRpcHealthSnapshot({
      latencyMs: null,
      httpStatus: null,
      activeEndpoint: failover.activeEndpoint ?? failover.primaryEndpoint,
      usingFallback: failover.usingFallback,
      thresholdMs,
    });
  });

  const refresh = useCallback(async () => {
    const fetcher = fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
    if (!fetcher) return;

    const failover = getRpcFailoverState();
    const fallbackEndpoint =
      failover.activeEndpoint ??
      failover.primaryEndpoint ??
      getRpcUrls("TESTNET")[0] ??
      "https://soroban-testnet.stellar.org:443";

    const startedAt = Date.now();
    try {
      const response = await fetcher(healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const elapsedMs = Date.now() - startedAt;

      let rpcLatencyMs: number | null = elapsedMs;
      let activeEndpoint = fallbackEndpoint;
      let serviceStatus: string | null = null;

      try {
        const body = (await response.json()) as {
          data?: {
            status?: string;
            services?: {
              stellar?: {
                rpcUrl?: string;
                rpc?: { status?: string; latencyMs?: number | null };
              };
            };
          };
        };
        const stellar = body?.data?.services?.stellar;
        if (stellar?.rpcUrl) {
          activeEndpoint = stellar.rpcUrl;
        }
        if (typeof stellar?.rpc?.latencyMs === "number") {
          rpcLatencyMs = stellar.rpc.latencyMs;
        }
        if (stellar?.rpc?.status === "error") {
          serviceStatus = "degraded";
        } else if (body?.data?.status) {
          serviceStatus = body.data.status;
        }
      } catch {
        // Non-JSON response body; rely on HTTP status and measured elapsed time.
      }

      setStatus(
        evaluateRpcHealthSnapshot({
          latencyMs: rpcLatencyMs,
          httpStatus: response.status,
          activeEndpoint,
          usingFallback: failover.usingFallback,
          serviceStatus,
          thresholdMs,
        }),
      );
    } catch {
      const elapsedMs = Date.now() - startedAt;
      setStatus(
        evaluateRpcHealthSnapshot({
          latencyMs: elapsedMs,
          httpStatus: 503,
          activeEndpoint: fallbackEndpoint,
          usingFallback: failover.usingFallback,
          serviceStatus: "degraded",
          thresholdMs,
        }),
      );
    }
  }, [fetchImpl, healthUrl, thresholdMs]);

  useEffect(() => {
    if (initialState || pollIntervalMs <= 0) return;
    let active = true;
    const tick = async () => {
      if (!active) return;
      await refresh();
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, pollIntervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initialState, pollIntervalMs, refresh]);

  return { ...status, refresh };
}
