"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback, useRef } from "react";
import { RPC_DEGRADED_LATENCY_THRESHOLD_MS } from "@/lib/rpc-failover";

export const RPC_HEALTH_EVENT = "ophirpay:rpc-health-event";

export interface RpcMetricReport {
  endpoint?: string | null;
  latencyMs?: number | null;
  status?: number | null;
  error?: string | Error | null;
}

export interface RpcHealthState {
  isDegraded: boolean;
  activeEndpoint: string | null;
  latencyMs: number | null;
  statusReason: string | null;
  errorRate: number; // 0 to 1
  consecutiveHealthyCount: number;
  lastCheckedAt: number | null;
}

export interface UseRpcHealthOptions {
  pollIntervalMs?: number;
  latencyThresholdMs?: number;
  initialState?: Partial<RpcHealthState>;
  healthEndpoint?: string;
  enabled?: boolean;
}

/** Global helper to broadcast RPC response metrics from anywhere in the client. */
export function reportGlobalRpcMetric(report: RpcMetricReport): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(RPC_HEALTH_EVENT, { detail: report })
  );
}

const DEFAULT_OPTIONS: Required<UseRpcHealthOptions> = {
  pollIntervalMs: 15_000,
  latencyThresholdMs: RPC_DEGRADED_LATENCY_THRESHOLD_MS,
  initialState: {},
  healthEndpoint: "/api/health",
  enabled: true,
};

export function useRpcHealth(options: UseRpcHealthOptions = {}) {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const { pollIntervalMs, latencyThresholdMs, healthEndpoint, enabled } = mergedOptions;

  const [state, setState] = useState<RpcHealthState>(() => ({
    isDegraded: false,
    activeEndpoint: null,
    latencyMs: null,
    statusReason: null,
    errorRate: 0,
    consecutiveHealthyCount: 0,
    lastCheckedAt: null,
    ...mergedOptions.initialState,
  }));

  // Track recent call metrics (up to 10 entries) to compute error rate
  const recentCallsRef = useRef<Array<{ success: boolean; timestamp: number }>>([]);

  const updateErrorRate = useCallback((success: boolean) => {
    const now = Date.now();
    const windowMs = 60_000;
    const history = recentCallsRef.current
      .filter((item) => now - item.timestamp < windowMs)
      .slice(-9);
    history.push({ success, timestamp: now });
    recentCallsRef.current = history;

    const failures = history.filter((item) => !item.success).length;
    return history.length > 0 ? failures / history.length : 0;
  }, []);

  const reportRpcCall = useCallback(
    (report: RpcMetricReport) => {
      const { endpoint, latencyMs, status, error } = report;
      const isRateLimited = status === 429;
      const isServerError = typeof status === "number" && status >= 500 && status <= 599;
      const isHighLatency = typeof latencyMs === "number" && latencyMs > latencyThresholdMs;
      const hasError = !!error || isRateLimited || isServerError;

      const rate = updateErrorRate(!hasError);

      if (isRateLimited || isServerError || isHighLatency || hasError) {
        let reason = "Degraded RPC network";
        if (isRateLimited) {
          reason = "Rate limited (HTTP 429)";
        } else if (isServerError) {
          reason = `Server error (HTTP ${status})`;
        } else if (isHighLatency && typeof latencyMs === "number") {
          reason = `High response time (${Math.round(latencyMs)}ms > ${latencyThresholdMs}ms)`;
        } else if (error) {
          reason = typeof error === "string" ? error : error.message;
        }

        setState((prev) => ({
          ...prev,
          isDegraded: true,
          activeEndpoint: endpoint ?? prev.activeEndpoint,
          latencyMs: typeof latencyMs === "number" ? Math.round(latencyMs) : prev.latencyMs,
          statusReason: reason,
          errorRate: rate,
          consecutiveHealthyCount: 0,
          lastCheckedAt: Date.now(),
        }));
      } else {
        // Healthy call reported
        setState((prev) => {
          const nextHealthy = prev.consecutiveHealthyCount + 1;
          const shouldClear = nextHealthy >= 1;
          return {
            ...prev,
            isDegraded: shouldClear ? false : prev.isDegraded,
            activeEndpoint: endpoint ?? prev.activeEndpoint,
            latencyMs: typeof latencyMs === "number" ? Math.round(latencyMs) : prev.latencyMs,
            statusReason: shouldClear ? null : prev.statusReason,
            errorRate: rate,
            consecutiveHealthyCount: nextHealthy,
            lastCheckedAt: Date.now(),
          };
        });
      }
    },
    [latencyThresholdMs, updateErrorRate]
  );

  const checkHealth = useCallback(async () => {
    if (typeof window === "undefined") return;

    try {
      const startTime = Date.now();
      const res = await fetch(healthEndpoint, {
        method: "GET",
        headers: { credentials: "same-origin" },
      });
      const clientLatency = Date.now() - startTime;

      if (!res.ok) {
        reportRpcCall({
          status: res.status,
          latencyMs: clientLatency,
          error: `Health check failed (HTTP ${res.status})`,
        });
        return;
      }

      const body = await res.json();
      const stellarRpc = body?.data?.services?.stellar?.rpc;
      const rpcFailover = body?.data?.rpcFailover;

      const endpoint = rpcFailover?.activeEndpoint ?? body?.data?.services?.stellar?.rpcUrl ?? null;
      const reportedLatency = typeof stellarRpc?.latencyMs === "number" ? stellarRpc.latencyMs : clientLatency;
      const isDegradedCondition =
        reportedLatency > latencyThresholdMs ||
        stellarRpc?.status === "error" ||
        rpcFailover?.degraded === true;

      if (isDegradedCondition) {
        let reason = "Degraded RPC network";
        if (reportedLatency > latencyThresholdMs) {
          reason = `High response time (${Math.round(reportedLatency)}ms > ${latencyThresholdMs}ms)`;
        } else if (stellarRpc?.status === "error") {
          reason = "Endpoint unavailable";
        } else if (rpcFailover?.degraded) {
          reason = "Failover degraded";
        }

        const rate = updateErrorRate(false);
        setState((prev) => ({
          ...prev,
          isDegraded: true,
          activeEndpoint: endpoint ?? prev.activeEndpoint,
          latencyMs: Math.round(reportedLatency),
          statusReason: reason,
          errorRate: rate,
          consecutiveHealthyCount: 0,
          lastCheckedAt: Date.now(),
        }));
      } else {
        // Healthy state observed
        const rate = updateErrorRate(true);
        setState((prev) => ({
          ...prev,
          isDegraded: false,
          activeEndpoint: endpoint ?? prev.activeEndpoint,
          latencyMs: Math.round(reportedLatency),
          statusReason: null,
          errorRate: rate,
          consecutiveHealthyCount: prev.consecutiveHealthyCount + 1,
          lastCheckedAt: Date.now(),
        }));
      }
    } catch (err) {
      reportRpcCall({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [healthEndpoint, latencyThresholdMs, reportRpcCall, updateErrorRate]);

  // Periodic polling
  useEffect(() => {
    if (!enabled || pollIntervalMs <= 0 || typeof window === "undefined") return;

    const timer = setInterval(() => {
      // Pause polling if tab is hidden
      if (document.hidden) return;
      void checkHealth();
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [enabled, pollIntervalMs, checkHealth]);

  // Listen to global custom events
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleEvent = (event: Event) => {
      const custom = event as CustomEvent<RpcMetricReport>;
      if (custom.detail) {
        reportRpcCall(custom.detail);
      }
    };

    window.addEventListener(RPC_HEALTH_EVENT, handleEvent);
    return () => {
      window.removeEventListener(RPC_HEALTH_EVENT, handleEvent);
    };
  }, [reportRpcCall]);

  const dismiss = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isDegraded: false,
      statusReason: null,
    }));
  }, []);

  return {
    ...state,
    refresh: checkHealth,
    reportRpcCall,
    dismiss,
  };
}
