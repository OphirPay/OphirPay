// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";

/**
 * Soroban RPC failover with caching and circuit breaking.
 *
 * • Caches the last known-good URL (TTL: 60 s) so healthy calls skip the probe.
 * • Circuit-breaker: when an endpoint fails a health check it enters a 30 s
 *   cooldown before being retried, preventing repeated timeouts against a
 *   degraded endpoint.
 * • On cache miss or expiry, probes URLs in order (primary → fallbacks)
 *   and returns the first healthy one.
 * • Tracks active endpoint, total failovers, and failure diagnostics.
 */

// ── Configuration ──────────────────────────────────────────────

export const FALLBACK_RPC_URLS: Record<string, string[]> = {
  TESTNET: [
    "https://soroban-testnet.stellar.org:443",
    "https://testnet.soroban.rpc.pulse.so:443",
  ],
  PUBLIC: [
    "https://soroban.stellar.org:443",
    "https://mainnet.soroban.rpc.pulse.so:443",
  ],
};

/** How long a cached healthy URL is trusted before re-probing. */
const CACHE_TTL_MS = 60_000;

/** How long a failed endpoint is excluded from probing. */
const CIRCUIT_COOLDOWN_MS = 30_000;

/** Timeout for individual health-check probes. */
const PROBE_TIMEOUT_MS = 3_000;

// ── State ──────────────────────────────────────────────────────

interface CircuitState {
  failedAt: number;
  url: string;
  reason: string;
}

export interface EndpointFailureInfo {
  lastFailureReason?: string;
  lastFailureAt?: number;
  failureCount: number;
}

export interface RpcFailoverState {
  activeUrl: string | null;
  primaryUrl: string;
  isPrimary: boolean;
  failoverCount: number;
  endpoints: Record<string, EndpointFailureInfo>;
}

const circuitBreakers = new Map<string, CircuitState>();
const endpointFailures = new Map<string, EndpointFailureInfo>();

let cachedUrl: string | null = null;
let cachedAt = 0;
let failoverCount = 0;

// ── Probe ──────────────────────────────────────────────────────

async function probeHealth(url: string): Promise<{ ok: boolean; reason?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, reason: `Probe timeout after ${PROBE_TIMEOUT_MS}ms` };
    }
    return { ok: false, reason: err?.message || "Connection refused" };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get a working Soroban RPC server.
 *
 * First checks the local cache; if stale, probes endpoints respecting
 * circuit-breaker cooldowns. Returns a server pointing at the first
 * healthy URL, or the primary as a last resort.
 */
export async function getWorkingRpcServer(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): Promise<rpc.Server> {
  const now = Date.now();
  const urls = FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET;
  const primaryUrl = urls[0];

  // ── Fast path: cached URL is still fresh ─────────────────
  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    return new rpc.Server(cachedUrl, { allowHttp: false });
  }

  // ── Probe URLs, skipping those in circuit-breaker cooldown ─
  let lastFailureReason = "All endpoints unavailable";
  for (const url of urls) {
    const breaker = circuitBreakers.get(url);
    if (breaker && now - breaker.failedAt < CIRCUIT_COOLDOWN_MS) {
      continue;
    }

    const { ok: healthy, reason } = await probeHealth(url);
    if (healthy) {
      const prevUrl = cachedUrl;
      cachedUrl = url;
      cachedAt = now;
      circuitBreakers.delete(url);

      // Log transition when failing over from previous active endpoint
      const transitionReason =
        prevUrl && url === primaryUrl
          ? "Primary endpoint recovered"
          : lastFailureReason;

      if (prevUrl && prevUrl !== url) {
        failoverCount += 1;
        logger.warn("RPC endpoint failover transition", {
          from: prevUrl,
          to: url,
          reason: transitionReason,
          failoverCount,
        });
      } else if (!prevUrl && url !== primaryUrl) {
        failoverCount += 1;
        logger.warn("RPC endpoint failover transition", {
          from: primaryUrl,
          to: url,
          reason: transitionReason,
          failoverCount,
        });
      }

      return new rpc.Server(url, { allowHttp: false });
    }

    // Mark failure and enter cooldown
    lastFailureReason = reason || "Unhealthy response";
    circuitBreakers.set(url, { failedAt: now, url, reason: lastFailureReason });

    const existing = endpointFailures.get(url) || { failureCount: 0 };
    endpointFailures.set(url, {
      lastFailureReason,
      lastFailureAt: now,
      failureCount: existing.failureCount + 1,
    });

    logger.warn("RPC endpoint unhealthy — circuit opened", {
      url,
      reason: lastFailureReason,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
    });
  }

  // ── All endpoints failed or in cooldown ─────────────────
  logger.error("All RPC endpoints unavailable — falling back to primary", {
    primaryUrl,
    failoverCount,
  });
  if (cachedUrl && cachedUrl !== primaryUrl) {
    failoverCount += 1;
    logger.warn("RPC endpoint failover transition to fallback primary", {
      from: cachedUrl,
      to: primaryUrl,
      reason: lastFailureReason,
      failoverCount,
    });
  }
  cachedUrl = primaryUrl;
  cachedAt = now;
  return new rpc.Server(primaryUrl, { allowHttp: false });
}

/**
 * Get current RPC failover state and health metrics.
 */
export function getRpcFailoverState(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): RpcFailoverState {
  const urls = FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET;
  const primaryUrl = urls[0];
  const activeUrl = cachedUrl || primaryUrl;

  const endpointsObj: Record<string, EndpointFailureInfo> = {};
  for (const url of urls) {
    endpointsObj[url] = endpointFailures.get(url) || { failureCount: 0 };
  }
  for (const [url, info] of endpointFailures.entries()) {
    if (!endpointsObj[url]) {
      endpointsObj[url] = info;
    }
  }

  return {
    activeUrl,
    primaryUrl,
    isPrimary: activeUrl === primaryUrl,
    failoverCount,
    endpoints: endpointsObj,
  };
}

/**
 * Get all configured RPC URLs for a network.
 */
export function getRpcUrls(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): string[] {
  return FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET;
}

/**
 * Reset all circuit breakers and the URL cache.
 */
export function resetRpcState(): void {
  circuitBreakers.clear();
  endpointFailures.clear();
  cachedUrl = null;
  cachedAt = 0;
  failoverCount = 0;
}
