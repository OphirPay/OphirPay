"use client";
// SPDX-License-Identifier: MIT

import { useRpcHealth, type UseRpcHealthOptions } from "@/hooks/useRpcHealth";

export interface NetworkStatusBannerProps {
  /** Optional custom hook options or mock overrides for testing */
  options?: UseRpcHealthOptions;
  /** Explicit override for degradation status (useful for visual testing) */
  forceDegraded?: boolean;
  /** Explicit active endpoint override */
  forceActiveEndpoint?: string;
  /** Explicit latency override in ms */
  forceLatencyMs?: number;
  /** Explicit reason override */
  forceStatusReason?: string;
}

/** Formats an endpoint URL for compact visual display without losing context */
export function formatEndpoint(url: string | null): string {
  if (!url) return "unknown";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Highlight provider name nicely if recognized
    if (host.includes("stellar.org")) {
      return host.replace(".stellar.org", "");
    }
    return host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

/**
 * Non-intrusive status banner displayed when Horizon or Soroban RPC endpoints
 * experience degraded network conditions (latency > 3000ms, rate limiting 429,
 * or 5xx outages).
 *
 * Requirements (issue #1295):
 * - Displays active RPC endpoint and estimated latency
 * - Auto-clears when healthy responses resume
 * - Non-intrusive and does not interfere with ErrorBoundary
 * - Complies with a11y standards (role="status", aria-live="polite")
 */
export function NetworkStatusBanner({
  options,
  forceDegraded,
  forceActiveEndpoint,
  forceLatencyMs,
  forceStatusReason,
}: NetworkStatusBannerProps) {
  const hookHealth = useRpcHealth(options);

  const isDegraded = forceDegraded ?? hookHealth.isDegraded;
  const activeEndpoint = forceActiveEndpoint ?? hookHealth.activeEndpoint;
  const latencyMs = forceLatencyMs ?? hookHealth.latencyMs;
  const statusReason = forceStatusReason ?? hookHealth.statusReason;
  const { refresh, dismiss } = hookHealth;

  if (!isDegraded) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="network-status-banner"
      className="sticky top-0 z-40 w-full bg-amber-500/95 dark:bg-amber-600/95 text-white backdrop-blur-sm border-b border-amber-600/30 px-4 py-2 text-xs md:text-sm font-medium transition-all duration-200 shadow-sm"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <svg
            className="w-4 h-4 flex-shrink-0 text-amber-100"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-semibold tracking-wide">RPC Network Degraded:</span>
            <span className="text-amber-100 truncate">
              {statusReason ?? "Degraded performance observed"}
            </span>

            {activeEndpoint && (
              <span
                className="inline-flex items-center gap-1 bg-amber-600/70 dark:bg-amber-700/70 text-amber-50 px-2 py-0.5 rounded text-[11px] font-mono border border-amber-400/20"
                title={activeEndpoint}
                data-testid="active-endpoint"
              >
                Active: {formatEndpoint(activeEndpoint)}
              </span>
            )}

            {latencyMs !== null && (
              <span
                className="inline-flex items-center bg-amber-600/70 dark:bg-amber-700/70 text-amber-50 px-2 py-0.5 rounded text-[11px] font-mono border border-amber-400/20"
                data-testid="estimated-latency"
              >
                Latency: ~{latencyMs}ms
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => refresh()}
            data-testid="banner-retry-btn"
            className="px-2.5 py-0.5 rounded bg-amber-600/80 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-medium cursor-pointer transition-colors shadow-xs"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss network warning banner"
            data-testid="banner-dismiss-btn"
            className="p-1 rounded hover:bg-amber-600/60 text-amber-100 hover:text-white cursor-pointer transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
