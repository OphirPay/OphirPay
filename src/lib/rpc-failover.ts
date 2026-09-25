// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";

/**
 * Soroban RPC failover with caching and circuit breaking.
 *
 * • Caches the last known-good URL (TTL: 60 s) so healthy calls skip the probe.
 * • Circuit-breaker: when an endpoint fails a health check it enters a 30 s
 *   cooldown before being retried, preventing repeated timeouts against a
 *   degraded endpoint.
 * • On cache miss or expiry, probes URLs in order (primary → fallbacks)
 *   and returns the first healthy one.
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
}

const circuitBreakers = new Map<string, CircuitState>();

let cachedUrl: string | null = null;
let cachedAt = 0;

// ── Observable failover state (issue #820) ─────────────────────────────
// Who is serving, how often we moved, and why — so operators don't need
// log archaeology during an upstream incident.

let failoverCount = 0;
let lastTransitionAt: number | null = null;
const lastFailureByUrl = new Map<string, string>();

export interface RpcFailoverState {
  activeUrl: string | null;
  primaryUrl: string | null;
  /** True when serving from a non-primary endpoint. */
  onFallback: boolean;
  failovers: number;
  lastTransitionAt: number | null;
  lastFailureByUrl: Record<string, string>;
}

/** Primary (first-listed) endpoint for a network. */
export function getPrimaryRpcUrl(network: "TESTNET" | "PUBLIC" = "TESTNET"): string {
  return (FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET)[0];
}

/** Current observable failover state (snapshot). */
export function getRpcFailoverState(
  network: "TESTNET" | "PUBLIC" = "TESTNET",
): RpcFailoverState {
  const primaryUrl = getPrimaryRpcUrl(network);
  const failures: Record<string, string> = {};
  for (const [url, reason] of lastFailureByUrl) failures[url] = reason;
  return {
    activeUrl: cachedUrl,
    primaryUrl,
    onFallback: cachedUrl !== null && cachedUrl !== primaryUrl,
    failovers: failoverCount,
    lastTransitionAt,
    lastFailureByUrl: failures,
  };
}

// ── Probe ──────────────────────────────────────────────────────

type ProbeOutcome = "ok" | "unhealthy" | "unreachable";

async function probeHealth(url: string): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    return res.ok ? "ok" : "unhealthy";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timeout);
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get a working Soroban RPC server.
 *
 * First checks the local cache; if stale, probes endpoints respecting
 * circuit-breaker cooldowns.  Returns a server pointing at the first
 * healthy URL, or the primary as a last resort.
 */
export async function getWorkingRpcServer(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): Promise<rpc.Server> {
  const now = Date.now();
  const urls = FALLBACK_RPC_URLS[network] ?? FALLBACK_RPC_URLS.TESTNET;

  // ── Fast path: cached URL is still fresh ─────────────────
  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    return new rpc.Server(cachedUrl, { allowHttp: false });
  }

  // ── Probe URLs, skipping those in circuit-breaker cooldown ─
  let primaryFailedThisPass = false;
  for (const url of urls) {
    const breaker = circuitBreakers.get(url);
    if (breaker && now - breaker.failedAt < CIRCUIT_COOLDOWN_MS) {
      continue;
    }

    const outcome = await probeHealth(url);
    if (outcome === "ok") {
      const moved = cachedUrl !== null && cachedUrl !== url;
      const coldFallback =
        cachedUrl === null && primaryFailedThisPass && url !== urls[0];
      if (moved || coldFallback) {
        failoverCount += 1;
        lastTransitionAt = now;
        incMetric("rpc_failovers_total");
        logger.warn("RPC endpoint failover", {
          from: cachedUrl ?? "(none)",
          to: url,
          reason:
            (cachedUrl && lastFailureByUrl.get(cachedUrl)) ??
            "primary failed probe this pass",
        });
      }
      cachedUrl = url;
      cachedAt = now;
      circuitBreakers.delete(url);
      return new rpc.Server(url, { allowHttp: false });
    }
    if (url === urls[0]) primaryFailedThisPass = true;

    // Mark as failed — enter cooldown
    const reason = outcome === "unhealthy" ? "probe unhealthy" : "probe unreachable";
    lastFailureByUrl.set(url, reason);
    circuitBreakers.set(url, { failedAt: now, url });
    logger.warn("RPC endpoint unhealthy — circuit opened", { url, cooldownMs: CIRCUIT_COOLDOWN_MS, reason });
  }

  // ── All endpoints failed or in cooldown ─────────────────
  logger.error("All RPC endpoints unavailable — falling back to primary");
  return new rpc.Server(urls[0], { allowHttp: false });
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
 * Reset all circuit breakers and the URL cache (useful in tests or
 * after a known network incident resolves).
 */
export function resetRpcState(): void {
  circuitBreakers.clear();
  cachedUrl = null;
  cachedAt = 0;
  failoverCount = 0;
  lastTransitionAt = null;
  lastFailureByUrl.clear();
}
