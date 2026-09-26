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
 * • Tracks failover state (active endpoint, transition count, per-endpoint
 *   last failure reason) so /api/metrics and /api/health can report which
 *   endpoint is serving traffic and whether the app is on a degraded
 *   fallback. Transitions are logged at warn level with both endpoint names.
 */

// ── Configuration ──────────────────────────────────────────────

export type RpcNetwork = "TESTNET" | "PUBLIC";

const FALLBACK_RPC_URLS: Record<RpcNetwork, string[]> = {
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

// ── Failover state ─────────────────────────────────────────────
//
// Per-network record of which endpoint is serving traffic, how many
// transitions have occurred, and why each endpoint last failed. This is
// the source of truth behind the RPC metrics and the health payload.

interface EndpointFailure {
  reason: string;
  failedAt: number;
}

interface FailoverState {
  /** Endpoint currently serving traffic; null until the first selection. */
  activeUrl: string | null;
  /** Number of transitions away from a previously active endpoint. */
  failoverCount: number;
  /** Epoch ms when the active endpoint last changed. */
  lastTransitionAt: number | null;
  /** Most recent failure reason per endpoint URL. */
  lastFailureByUrl: Map<string, EndpointFailure>;
}

const failoverStates = new Map<RpcNetwork, FailoverState>();

function resolveNetwork(network: RpcNetwork): RpcNetwork {
  return network in FALLBACK_RPC_URLS ? network : "TESTNET";
}

function stateFor(network: RpcNetwork): FailoverState {
  const resolved = resolveNetwork(network);
  let state = failoverStates.get(resolved);
  if (!state) {
    state = {
      activeUrl: null,
      failoverCount: 0,
      lastTransitionAt: null,
      lastFailureByUrl: new Map(),
    };
    failoverStates.set(resolved, state);
  }
  return state;
}

/** Record why an endpoint probe failed (surfaced in metrics and health). */
function recordEndpointFailure(
  network: RpcNetwork,
  url: string,
  reason: string
): void {
  stateFor(network).lastFailureByUrl.set(url, { reason, failedAt: Date.now() });
}

/**
 * Move the active endpoint for a network. Before the first selection the
 * primary is the implicit active endpoint, so selecting a fallback on the
 * very first probe already counts as a failover; re-selecting the primary
 * never does. Every failover is logged at warn level with both endpoint
 * names and the failure reason.
 */
function transitionActiveEndpoint(
  network: RpcNetwork,
  nextUrl: string,
  reason?: string
): void {
  const state = stateFor(network);
  const prevUrl =
    state.activeUrl ?? FALLBACK_RPC_URLS[resolveNetwork(network)][0];
  if (prevUrl === nextUrl) return;

  state.failoverCount += 1;
  logger.warn("RPC endpoint transition", {
    network: resolveNetwork(network),
    from: prevUrl,
    to: nextUrl,
    reason: reason ?? state.lastFailureByUrl.get(prevUrl)?.reason ?? "unknown",
  });
  state.activeUrl = nextUrl;
  state.lastTransitionAt = Date.now();
}

// ── Probe ──────────────────────────────────────────────────────

async function probeHealth(
  url: string
): Promise<{ healthy: boolean; reason?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    return res.ok
      ? { healthy: true }
      : { healthy: false, reason: `health check returned HTTP ${res.status}` };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `health check timed out after ${PROBE_TIMEOUT_MS}ms`
        : `health check failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
    return { healthy: false, reason };
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
  network: RpcNetwork = "TESTNET"
): Promise<rpc.Server> {
  const now = Date.now();
  const urls = FALLBACK_RPC_URLS[resolveNetwork(network)];

  // ── Fast path: cached URL is still fresh ─────────────────
  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    return new rpc.Server(cachedUrl, { allowHttp: false });
  }

  // ── Probe URLs, skipping those in circuit-breaker cooldown ─
  for (const url of urls) {
    const breaker = circuitBreakers.get(url);
    if (breaker && now - breaker.failedAt < CIRCUIT_COOLDOWN_MS) {
      continue;
    }

    const probe = await probeHealth(url);
    if (probe.healthy) {
      cachedUrl = url;
      cachedAt = now;
      circuitBreakers.delete(url);
      transitionActiveEndpoint(network, url);
      return new rpc.Server(url, { allowHttp: false });
    }

    // Mark as failed — enter cooldown
    circuitBreakers.set(url, { failedAt: now, url });
    recordEndpointFailure(network, url, probe.reason ?? "health check failed");
    logger.warn("RPC endpoint unhealthy — circuit opened", { url, cooldownMs: CIRCUIT_COOLDOWN_MS });
  }

  // ── All endpoints failed or in cooldown ─────────────────
  logger.error("All RPC endpoints unavailable — falling back to primary");
  transitionActiveEndpoint(network, urls[0], "all configured endpoints unavailable");
  return new rpc.Server(urls[0], { allowHttp: false });
}

/**
 * Get all configured RPC URLs for a network.
 */
export function getRpcUrls(
  network: RpcNetwork = "TESTNET"
): string[] {
  return FALLBACK_RPC_URLS[resolveNetwork(network)];
}

// ── Failover state snapshots ───────────────────────────────────

export interface RpcEndpointStatus {
  url: string;
  isPrimary: boolean;
  isActive: boolean;
  lastFailureReason: string | null;
  /** Epoch ms of the most recent failure, if any. */
  lastFailureAt: number | null;
}

export interface RpcFailoverSnapshot {
  network: RpcNetwork;
  primaryUrl: string;
  /** Endpoint currently serving traffic (defaults to primary before first selection). */
  activeUrl: string;
  /** True while the active endpoint is the configured primary. */
  onPrimary: boolean;
  failoverCount: number;
  /** Epoch ms when the active endpoint last changed; null before first selection. */
  lastTransitionAt: number | null;
  endpoints: RpcEndpointStatus[];
}

/**
 * Read the failover state for one network. Before the first probe has run,
 * the primary is reported as the active endpoint — nothing has failed yet.
 */
export function getRpcFailoverSnapshot(
  network: RpcNetwork = "TESTNET"
): RpcFailoverSnapshot {
  const resolved = resolveNetwork(network);
  const urls = FALLBACK_RPC_URLS[resolved];
  const state = stateFor(resolved);
  const activeUrl = state.activeUrl ?? urls[0];

  return {
    network: resolved,
    primaryUrl: urls[0],
    activeUrl,
    onPrimary: activeUrl === urls[0],
    failoverCount: state.failoverCount,
    lastTransitionAt: state.lastTransitionAt,
    endpoints: urls.map((url) => {
      const failure = state.lastFailureByUrl.get(url);
      return {
        url,
        isPrimary: url === urls[0],
        isActive: url === activeUrl,
        lastFailureReason: failure?.reason ?? null,
        lastFailureAt: failure?.failedAt ?? null,
      };
    }),
  };
}

/** Snapshots for every configured network (for metrics serialization). */
export function getAllRpcFailoverSnapshots(): RpcFailoverSnapshot[] {
  return (Object.keys(FALLBACK_RPC_URLS) as RpcNetwork[]).map((network) =>
    getRpcFailoverSnapshot(network)
  );
}

/**
 * Reset all circuit breakers, the URL cache, and failover state (useful in
 * tests or after a known network incident resolves).
 */
export function resetRpcState(): void {
  circuitBreakers.clear();
  cachedUrl = null;
  cachedAt = 0;
  failoverStates.clear();
}
