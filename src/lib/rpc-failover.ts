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
 * • Tracks active endpoint, failover counter, and per-endpoint failure reasons.
 */

// ── Configuration ──────────────────────────────────────────────

const FALLBACK_RPC_URLS: Record<string, string[]> = {
  TESTNET: [
    "https://soroban-testnet.stellar.org:443",
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

const circuitBreakers = new Map<string, CircuitState>();

let cachedUrl: string | null = null;
let cachedAt = 0;
let activeEndpoint: string | null = null;
let failoverCount = 0;
const lastFailures = new Map<string, { timestamp: number; reason: string }>();

export interface RpcFailoverState {
  activeEndpoint: string | null;
  primaryEndpoint: string;
  onFallback: boolean;
  failoverCount: number;
  lastFailures: Record<string, { timestamp: number; reason: string }>;
}

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
    if (!res.ok) {
      return { ok: false, reason: `HTTP status ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const isTimeout = controller.signal.aborted;
    const msg = isTimeout ? "probe timeout" : err instanceof Error ? err.message : "network error";
    return { ok: false, reason: msg };
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
  const primary = urls[0];

  // ── Fast path: cached URL is still fresh ─────────────────
  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    activeEndpoint = cachedUrl;
    return new rpc.Server(cachedUrl, { allowHttp: false });
  }

  const prevActive = activeEndpoint || primary;

  // ── Probe URLs, skipping those in circuit-breaker cooldown ─
  for (const url of urls) {
    const breaker = circuitBreakers.get(url);
    if (breaker && now - breaker.failedAt < CIRCUIT_COOLDOWN_MS) {
      continue;
    }

    const probeResult = await probeHealth(url);
    if (probeResult.ok) {
      if (prevActive && prevActive !== url) {
        failoverCount++;
        try {
          const { incMetric } = await import("@/lib/metrics-counters");
          incMetric("rpc_failovers_total");
        } catch {
          // metrics optional in isolated context
        }
        const lastFailure = lastFailures.get(prevActive)?.reason || "endpoint probe failed";
        logger.warn("RPC failover transition", {
          from: prevActive,
          to: url,
          reason: lastFailure,
        });
      }
      cachedUrl = url;
      cachedAt = now;
      activeEndpoint = url;
      circuitBreakers.delete(url);
      return new rpc.Server(url, { allowHttp: false });
    }

    // Mark as failed — enter cooldown
    const reason = probeResult.reason || "health check failed";
    circuitBreakers.set(url, { failedAt: now, url, reason });
    lastFailures.set(url, { timestamp: now, reason });
    logger.warn("RPC endpoint unhealthy — circuit opened", {
      url,
      reason,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
    });
  }

  // ── All endpoints failed or in cooldown ─────────────────
  logger.error("All RPC endpoints unavailable — falling back to primary");
  activeEndpoint = primary;
  return new rpc.Server(primary, { allowHttp: false });
}

/**
 * Get the current RPC failover health and metrics state.
 */
export function getRpcFailoverState(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): RpcFailoverState {
  const urls = FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET;
  const primary = urls[0] ?? "";
  const current = activeEndpoint || cachedUrl || primary;
  return {
    activeEndpoint: current,
    primaryEndpoint: primary,
    onFallback: Boolean(current && current !== primary),
    failoverCount,
    lastFailures: Object.fromEntries(lastFailures.entries()),
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
 * Reset all circuit breakers, the URL cache, and failover metrics
 * (useful in tests or after a known network incident resolves).
 */
export function resetRpcState(): void {
  circuitBreakers.clear();
  cachedUrl = null;
  cachedAt = 0;
  failoverCount = 0;
  activeEndpoint = null;
  lastFailures.clear();
}
