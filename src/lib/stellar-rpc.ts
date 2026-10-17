// SPDX-License-Identifier: MIT
/**
 * Resilient Stellar / Soroban RPC Client Wrapper (Issue #1421).
 *
 * Wraps Soroban RPC and Stellar Horizon calls with the per-endpoint
 * `RpcCircuitBreaker` (`CLOSED` → `OPEN` → `HALF_OPEN`) and automatic
 * multi-endpoint failover:
 *   • Primary endpoint is used while its circuit is `CLOSED`.
 *   • After 5 consecutive failures on an endpoint, its circuit trips `OPEN`
 *     for a 30-second cooldown and subsequent requests immediately route to
 *     the configured secondary/fallback RPC URLs without waiting on the dead
 *     primary.
 *   • Once the 30-second cooldown expires, the primary circuit enters
 *     `HALF_OPEN` and runs a lightweight `getLatestLedger` probe before
 *     resuming primary traffic.
 *   • If every configured endpoint's circuit is currently `OPEN` inside its
 *     cooldown window, requests fail fast with `CircuitOpenError` to prevent
 *     API request thread starvation.
 */

import { Horizon, rpc } from "@stellar/stellar-sdk";
import {
  CircuitOpenError,
  getEndpointCircuitBreaker,
  getRpcCircuitBreakerSnapshot,
  resetRpcCircuitBreakers,
  type CircuitBreakerOptions,
} from "@/lib/rpc-circuit-breaker";
import { getRpcUrls } from "@/lib/rpc-failover";
import {
  HORIZON_URL,
  STELLAR_NETWORK,
  type StellarNetworkKey,
} from "@/lib/stellar";
import {
  getHorizonTimeoutMs,
  getSorobanTimeoutMs,
  withStellarTimeoutProxy,
} from "@/lib/timeout";
import { logger } from "@/lib/logger";

export interface SorobanFailoverCallOptions {
  network?: StellarNetworkKey;
  urls?: string[];
  failureThreshold?: number;
  cooldownMs?: number;
  probeTimeoutMs?: number;
  skipHalfOpenProbe?: boolean;
}

export interface SorobanFailoverCallResult<T> {
  result: T;
  endpointUrl: string;
  usedFallback: boolean;
}

function buildSorobanServer(url: string): rpc.Server {
  const timeoutMs = getSorobanTimeoutMs();
  const raw = new rpc.Server(url, {
    allowHttp: url.startsWith("http://"),
    timeout: timeoutMs,
  });
  return withStellarTimeoutProxy(raw, timeoutMs, "Soroban RPC");
}

function buildHorizonServer(url: string): Horizon.Server {
  const timeoutMs = getHorizonTimeoutMs();
  const raw = new Horizon.Server(url, {
    allowHttp: url.startsWith("http://"),
  });
  return withStellarTimeoutProxy(raw, timeoutMs, "Horizon");
}

/**
 * Execute an operation against Soroban RPC with per-endpoint circuit breaking
 * and automatic failover across primary and fallback URLs.
 */
export async function executeSorobanRpcWithFailover<T>(
  operation: (server: rpc.Server, endpointUrl: string) => Promise<T>,
  options: SorobanFailoverCallOptions = {}
): Promise<SorobanFailoverCallResult<T>> {
  const network = options.network ?? STELLAR_NETWORK;
  const urls =
    options.urls && options.urls.length > 0 ? options.urls : getRpcUrls(network);

  if (urls.length === 0) {
    throw new Error(`No Soroban RPC URLs configured for network ${network}`);
  }

  const primaryUrl = urls[0]!;
  let lastError: unknown = null;
  let allCircuitsOpen = true;
  let shortestRetryAfterMs = Number.POSITIVE_INFINITY;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    const breakerOpts: Omit<CircuitBreakerOptions, "endpoint"> = {
      failureThreshold: options.failureThreshold,
      cooldownMs: options.cooldownMs,
      probeTimeoutMs: options.probeTimeoutMs,
    };
    const breaker = getEndpointCircuitBreaker(url, breakerOpts);
    const currentState = breaker.getState();

    if (currentState === "OPEN") {
      const remaining = breaker.getRemainingCooldownMs();
      if (remaining < shortestRetryAfterMs) {
        shortestRetryAfterMs = remaining;
      }
      continue;
    }

    allCircuitsOpen = false;

    try {
      const server = buildSorobanServer(url);
      const result = await breaker.execute(
        () => operation(server, url),
        { skipProbe: options.skipHalfOpenProbe }
      );

      if (i > 0) {
        logger.warn("Stellar RPC client served request via fallback endpoint", {
          primaryEndpoint: primaryUrl,
          activeEndpoint: url,
        });
      }

      return {
        result,
        endpointUrl: url,
        usedFallback: i > 0,
      };
    } catch (err) {
      lastError = err;
      if (err instanceof CircuitOpenError) {
        if (err.retryAfterMs < shortestRetryAfterMs) {
          shortestRetryAfterMs = err.retryAfterMs;
        }
      }
    }
  }

  if (allCircuitsOpen || lastError instanceof CircuitOpenError) {
    throw new CircuitOpenError(
      primaryUrl,
      Number.isFinite(shortestRetryAfterMs) ? shortestRetryAfterMs : 0
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "All Soroban RPC endpoints failed"));
}

/**
 * Execute an operation against Stellar Horizon guarded by a circuit breaker.
 */
export async function executeHorizonWithCircuitBreaker<T>(
  operation: (server: Horizon.Server, horizonUrl: string) => Promise<T>,
  options: {
    horizonUrl?: string;
    failureThreshold?: number;
    cooldownMs?: number;
  } = {}
): Promise<T> {
  const url = options.horizonUrl ?? HORIZON_URL;
  const breaker = getEndpointCircuitBreaker(url, {
    failureThreshold: options.failureThreshold,
    cooldownMs: options.cooldownMs,
  });

  const server = buildHorizonServer(url);
  return breaker.execute(() => operation(server, url), { skipProbe: true });
}

export {
  CircuitOpenError,
  getEndpointCircuitBreaker,
  getRpcCircuitBreakerSnapshot,
  resetRpcCircuitBreakers,
};
