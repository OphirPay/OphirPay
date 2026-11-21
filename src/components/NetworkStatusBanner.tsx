"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";
import {
  RPC_HEALTH_LATENCY_THRESHOLD_MS,
  formatRpcEndpoint,
  useRpcHealth,
} from "@/hooks/useRpcHealth";

/**
 * Thin, non-blocking warning shown while Soroban RPC is degraded or browser is offline.
 *
 * It is mounted in `AppShell` outside the route `ErrorBoundary`, so a failing
 * RPC never replaces page content with an error screen and a page-level crash
 * never unmounts the banner. The banner is purely informational: it does not
 * intercept requests, retry transactions, or alter any error boundary.
 *
 * Visible when browser connection is lost (`offline` event / `!navigator.onLine`),
 * or when the latest probe failed (5xx / 429 / timeout) or its latency
 * exceeded {@link RPC_HEALTH_LATENCY_THRESHOLD_MS}. A single healthy probe
 * or network reconnection clears it automatically.
 */
export function NetworkStatusBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    if (typeof navigator !== "undefined") {
      setIsOffline(!navigator.onLine);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const {
    status,
    latencyMs,
    activeEndpoint,
    activeProviderName,
    usingFallback,
    refresh,
  } = useRpcHealth();

  if (isOffline) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="network-status-banner"
        data-state="offline"
        className="sticky top-0 z-50 w-full border-b border-amber-400 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm dark:bg-amber-600"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-x-2">
          <span
            aria-hidden="true"
            className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-white animate-pulse"
          />
          <span>
            You are currently offline. Network operations and transaction submissions are unavailable.
          </span>
        </div>
      </div>
    );
  }

  if (status !== "degraded") return null;

  const slow =
    latencyMs !== null && latencyMs > RPC_HEALTH_LATENCY_THRESHOLD_MS;
  const headline = slow
    ? "Stellar network is slow"
    : "Stellar RPC is unavailable";
  const provider =
    activeProviderName || formatRpcEndpoint(activeEndpoint) || "unknown RPC";
  const latencyLabel =
    latencyMs !== null ? `~${Math.round(latencyMs).toLocaleString()} ms` : "latency unknown";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="network-status-banner"
      data-state="degraded"
      data-latency-ms={latencyMs ?? undefined}
      data-using-fallback={usingFallback ? "true" : "false"}
      className="sticky top-0 z-40 w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500"
        />
        <span className="font-medium">{headline}</span>
        <span className="text-amber-900 dark:text-amber-200">
          via <span data-testid="network-status-endpoint">{provider}</span>
          {" · "}
          <span data-testid="network-status-latency">{latencyLabel}</span>
          {usingFallback ? " · failover provider active" : ""}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded-md border border-amber-400/70 px-2 py-0.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900/60"
          aria-label="Recheck RPC health"
        >
          Recheck
        </button>
      </div>
    </div>
  );
}
