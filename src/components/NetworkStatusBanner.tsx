"use client";
// SPDX-License-Identifier: MIT

import { useHookRpcHealthState } from "@/components/NetworkStatusBanner.helpers";
import { useRpcHealth, type RpcHealthStatus, type UseRpcHealthOptions } from "@/hooks/useRpcHealth";

export interface NetworkStatusBannerProps extends UseRpcHealthOptions {
  /** Optional controlled health state override. */
  healthOverride?: RpcHealthStatus;
}

/**
 * Non-intrusive warning banner displayed when Stellar RPC / Horizon endpoints
 * experience high latency (>3000ms), HTTP 429/5xx errors, or failover (#1295).
 * Automatically clears when healthy responses resume.
 */
export function NetworkStatusBanner({
  healthOverride,
  ...hookOptions
}: NetworkStatusBannerProps = {}) {
  const hookHealth = useRpcHealth({
    ...hookOptions,
    pollIntervalMs: healthOverride ? 0 : hookOptions.pollIntervalMs,
  });
  const health = healthOverride ?? hookHealth;
  const { dismissed, setDismissed } = useHookRpcHealthState(health.degraded);

  if (!health.degraded || dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="network-status-banner"
      className="bg-amber-500/15 border-b border-amber-500/40 text-amber-200 px-4 py-2 text-xs md:text-sm flex flex-wrap items-center justify-between gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="font-medium">
          Degraded Stellar RPC network conditions:
        </span>
        <span>{health.reason ?? "Elevated response latency"}</span>
        <span className="text-amber-300/90 font-mono" data-testid="rpc-active-endpoint">
          Provider: {health.activeEndpoint}
        </span>
        {health.latencyMs !== null && (
          <span className="text-amber-300/90 font-mono" data-testid="rpc-estimated-latency">
            ({Math.round(health.latencyMs)}ms)
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss network status warning"
        className="text-amber-300 hover:text-amber-100 underline text-xs"
      >
        Dismiss
      </button>
    </div>
  );
}
