// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import { RPC_PROBE_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from "@/lib/timeout";

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

const FALLBACK_RPC_URLS: Record<string, string[]> = {
  TESTNET: [
    "https://soroban-testnet.stellar.org:443",
  ],
  PUBLIC: [
    "https://soroban.stellar.org:443",
    "https://mainnet.soroban.rpc.pulse.so:443",
  ],
};

const CACHE_TTL_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 30_000;
export const PROBE_TIMEOUT_MS = RPC_PROBE_TIMEOUT_MS;

interface CircuitState {
  failedAt: number;
  url: string;
}

const circuitBreakers = new Map<string, CircuitState>();

let cachedUrl: string | null = null;
let cachedAt = 0;

async function probeHealth(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      },
      timeoutMs
    );
    return res.ok;
  } catch (err) {
    if (isTimeoutError(err)) {
      logger.warn("RPC probe timed out", { url, timeoutMs });
    }
    return false;
  }
}

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

  if (cachedUrl && now - cachedAt < CACHE_TTL_MS) {
    return new rpc.Server(cachedUrl, { allowHttp: false });
  }

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
      return new rpc.Server(url, { allowHttp: false });
    }

    circuitBreakers.set(url, { failedAt: now, url });
    logger.warn("RPC endpoint unhealthy — circuit opened", { url, cooldownMs: CIRCUIT_COOLDOWN_MS });
  }

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
}
