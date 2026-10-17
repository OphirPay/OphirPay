// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import { getFailoverProbeTimeoutMs, getSorobanTimeoutMs } from "@/lib/timeout";
import { resetAllCircuitBreakers } from "@/lib/rpc-circuit-breaker";

/**
 * Soroban RPC failover with caching and circuit breaking.
 *
 * • Caches the last known-good URL (TTL: 60 s) so healthy calls skip the probe.
 * • Circuit-breaker: when an endpoint fails a health check it enters a 30 s
 *   cooldown before being retried, preventing repeated timeouts against a
 *   degraded endpoint.
 * • On cache miss or expiry, probes URLs in order (primary → fallbacks)
 *   and returns the first healthy one.
 * • Failover observability (issue #820): the active endpoint, the cumulative
 *   failover count, the last failure reason per endpoint and the time spent
 *   on a non-primary endpoint are tracked in-process and exposed through
 *   `getRpcFailoverState()` — surfaced by `/api/health` and `/api/metrics`.
 *   Every endpoint transition is logged at warn level with both endpoint
 *   names and the failure reason.
 */

// ── Configuration ──────────────────────────────────────────────

const FALLBACK_RPC_URLS: Record<string, string[]> = {
  TESTNET: [
    "https://soroban-testnet.stellar.org:443",
    "https://rpc-futurenet.stellar.org:443",
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

/**
 * Timeout for individual health-check probes. Configurable via
 * `RPC_PROBE_TIMEOUT_MS` (see `lib/timeout.ts`, issue #747).
 */
function probeTimeoutMs(): number {
  return getFailoverProbeTimeoutMs();
}

/**
 * A non-primary endpoint in use for longer than this raises the
 * `RpcFailoverDegraded` Prometheus alert (see monitoring/prometheus-alerts.yml).
 */
export const RPC_FAILOVER_DEGRADED_AFTER_MS = 120_000;

// ── State ──────────────────────────────────────────────────────

interface CircuitState {
  failedAt: number;
  url: string;
}

const circuitBreakers = new Map<string, CircuitState>();

let cachedUrl: string | null = null;
let cachedAt = 0;

// ── Failover observability state (issue #820) ─────────────────

/** The endpoint currently being served from (null until the first call). */
let activeEndpoint: string | null = null;

/** The endpoint an operator would expect: the first URL for the network. */
let primaryEndpoint: string | null = FALLBACK_RPC_URLS.TESTNET[0] ?? null;

/** Cumulative count of transitions to a non-primary endpoint. */
let failoverCount = 0;

/** Cumulative count of transitions back to the primary endpoint. */
let recoveries = 0;

/** Unix ms of the last transition (any direction). */
let lastTransitionAt: number | null = null;

/** Human-readable reason the last probe failed, per endpoint. */
const lastFailureReasons = new Map<string, string>();

/** Unix ms of the last failed probe per endpoint. */
const lastFailureAt = new Map<string, number>();

/** When the current (non-primary) failover episode began. */
let currentFailoverStartedAt: number | null = null;

/** Whether the current episode has already raised its transition log. */
let degradedLogged = false;

/** Longest fallback episode observed since process start (ms). */
let longestFallbackDuration = 0;

/** Probe-attempt counters per endpoint (cumulative). */
const probeCounts = new Map<string, { total: number; failed: number }>();

/** Exported failover snapshot (see `getRpcFailoverState`). */
export interface RpcFailoverState {
  /** Endpoint currently serving requests; null before the first RPC call. */
  activeEndpoint: string | null;
  /** First configured endpoint for the network. */
  primaryEndpoint: string | null;
  /**
   * True while serving from a non-primary endpoint; false before the first
   * RPC call and whenever the primary endpoint is serving.
   */
  usingFallback: boolean;
  /** Cumulative transitions away from the primary endpoint. */
  failoverCount: number;
  /** Cumulative transitions back to the primary endpoint. */
  recoveryCount: number;
  /** How long the current fallback episode has been running (ms), 0 when primary. */
  currentFallbackDurationMs: number;
  /** Longest fallback episode observed since process start (ms). */
  longestFallbackDurationMs: number;
  /** Unix ms of the last endpoint transition. */
  lastTransitionAt: number | null;
  /** Last failure reason per endpoint that failed at least once. */
  lastFailureReasons: Record<string, string>;
  /** Unix ms of the last failed probe per endpoint. */
  lastFailureAt: Record<string, number>;
  /** Cumulative probe attempts / failures per endpoint. */
  probes: Record<string, { total: number; failed: number }>;
}

function reasonFromError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return "timeout";
    }
    return err.message || err.name;
  }
  return String(err);
}

/** Record a failed probe for observability. */
function recordProbeFailure(url: string, reason: string): void {
  lastFailureReasons.set(url, reason);
  lastFailureAt.set(url, Date.now());
  const counts = probeCounts.get(url) ?? { total: 0, failed: 0 };
  counts.total += 1;
  counts.failed += 1;
  probeCounts.set(url, counts);
}

/** Record a successful probe for observability. */
function recordProbeSuccess(url: string): void {
  const counts = probeCounts.get(url) ?? { total: 0, failed: 0 };
  counts.total += 1;
  probeCounts.set(url, counts);
}

/**
 * Update the tracked active endpoint, counting and logging every transition.
 * Logged at warn level with both endpoint names and the failure reason so an
 * operator watching logs sees exactly why traffic moved (issue #820).
 */
function setActiveEndpoint(nextUrl: string, reason: string): void {
  const previous = activeEndpoint;
  activeEndpoint = nextUrl;
  const primary = primaryEndpoint;
  if (previous === nextUrl) return;

  const now = Date.now();
  lastTransitionAt = now;
  const wasOnPrimary = previous === null || previous === primary;
  const isOnPrimary = nextUrl === primary;

  if (!isOnPrimary && wasOnPrimary) {
    failoverCount += 1;
    currentFailoverStartedAt = now;
    degradedLogged = false;
    logger.warn("RPC failover: switching endpoints", {
      from: previous ?? "(none)",
      to: nextUrl,
      reason,
      failoverCount,
    });
  } else if (isOnPrimary && previous !== null) {
    recoveries += 1;
    if (currentFailoverStartedAt !== null) {
      const durationMs = now - currentFailoverStartedAt;
      if (durationMs > longestFallbackDuration) longestFallbackDuration = durationMs;
      logger.warn("RPC failover: recovered to primary endpoint", {
        from: previous,
        to: nextUrl,
        reason,
        fallbackDurationMs: durationMs,
      });
      currentFailoverStartedAt = null;
    }
  }
}

/**
 * Create an RPC server with an explicit, configurable request timeout so a
 * degraded endpoint aborts instead of hanging the request (issue #747).
 */
function createRpcServer(url: string): rpc.Server {
  return new rpc.Server(url, {
    allowHttp: false,
    timeout: getSorobanTimeoutMs(),
  });
}

// ── Probe ──────────────────────────────────────────────────────

async function probeHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs());

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      recordProbeFailure(url, `HTTP ${res.status}`);
      return false;
    }
    recordProbeSuccess(url);
    return true;
  } catch (err) {
    recordProbeFailure(url, reasonFromError(err));
    return false;
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

  if (primaryEndpoint !== urls[0]) {
    primaryEndpoint = urls[0] ?? null;
  }

  // ── Fast path: cached URL is still fresh ─────────────────
  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    setActiveEndpoint(cachedUrl, "cache hit");
    return createRpcServer(cachedUrl);
  }

  // ── Probe URLs, skipping those in circuit-breaker cooldown ─
  for (const url of urls) {
    const breaker = circuitBreakers.get(url);
    if (breaker && now - breaker.failedAt < CIRCUIT_COOLDOWN_MS) {
      continue;
    }

    const healthy = await probeHealth(url);
    if (healthy) {
      cachedUrl = url;
      cachedAt = now;
      circuitBreakers.delete(url);
      setActiveEndpoint(url, "health probe succeeded");
      return createRpcServer(url);
    }

    // Mark as failed — enter cooldown
    circuitBreakers.set(url, { failedAt: now, url });
    logger.warn("RPC endpoint unhealthy — circuit opened", { url, cooldownMs: CIRCUIT_COOLDOWN_MS });
  }

  // ── All endpoints failed or in cooldown ─────────────────
  logger.error("All RPC endpoints unavailable — falling back to primary");
  setActiveEndpoint(urls[0], "all endpoints failed");
  return createRpcServer(urls[0]);
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
 * Snapshot of the failover state for `/api/health` and `/api/metrics`
 * (issue #820). Cheap — no I/O, safe to call on every scrape.
 */
export function getRpcFailoverState(): RpcFailoverState {
  const now = Date.now();
  const usingFallback =
    activeEndpoint !== null && activeEndpoint !== primaryEndpoint;
  return {
    activeEndpoint,
    primaryEndpoint,
    usingFallback,
    failoverCount,
    recoveryCount: recoveries,
    currentFallbackDurationMs:
      currentFailoverStartedAt !== null ? now - currentFailoverStartedAt : 0,
    longestFallbackDurationMs: longestFallbackDuration,
    lastTransitionAt,
    lastFailureReasons: Object.fromEntries(lastFailureReasons),
    lastFailureAt: Object.fromEntries(lastFailureAt),
    probes: Object.fromEntries(probeCounts),
  };
}

/**
 * True when a non-primary endpoint has been in use longer than the
 * configured degraded threshold — the condition behind the
 * `RpcFailoverDegraded` alert rule.
 */
export function isRpcFailoverDegraded(): boolean {
  return (
    currentFailoverStartedAt !== null &&
    Date.now() - currentFailoverStartedAt > RPC_FAILOVER_DEGRADED_AFTER_MS
  );
}

/**
 * Reset all circuit breakers, the URL cache and the failover tracking state
 * (useful in tests or after a known network incident resolves).
 */
export function resetRpcState(): void {
  circuitBreakers.clear();
  resetAllCircuitBreakers();
  cachedUrl = null;
  cachedAt = 0;
  activeEndpoint = null;
  primaryEndpoint = FALLBACK_RPC_URLS.TESTNET[0] ?? null;
  failoverCount = 0;
  recoveries = 0;
  lastTransitionAt = null;
  lastFailureReasons.clear();
  lastFailureAt.clear();
  probeCounts.clear();
  currentFailoverStartedAt = null;
  degradedLogged = false;
  longestFallbackDuration = 0;
}

// `degradedLogged` is currently only informational; keep it referenced so a
// future alert-side consumer (e.g. a once-per-episode log) cannot be removed
// accidentally by a linter.
void degradedLogged;
