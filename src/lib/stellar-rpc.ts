// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import {
  getCircuitBreaker,
  type CircuitBreakerSnapshot,
  type CircuitBreakerConfig,
} from "@/lib/rpc-circuit-breaker";
import {
  getWorkingRpcServer,
  getRpcUrls,
  getRpcFailoverState,
  type RpcFailoverState,
} from "@/lib/rpc-failover";

export {
  RpcCircuitBreaker,
  RpcCircuitBreakerOpenError,
  getCircuitBreaker,
  getAllCircuitBreakerSnapshots,
  resetAllCircuitBreakers,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
} from "@/lib/rpc-circuit-breaker";

/**
 * Creates or retrieves a healthy Soroban RPC server with circuit breaker guardrails.
 * If the primary endpoint's circuit is OPEN, automatically falls over to configured
 * secondary RPC endpoints.
 */
export async function getProtectedRpcServer(
  network: "TESTNET" | "PUBLIC" = "TESTNET",
  config?: CircuitBreakerConfig
): Promise<{ server: rpc.Server; endpoint: string }> {
  const urls = getRpcUrls(network);

  for (const url of urls) {
    const breaker = getCircuitBreaker(url, config);
    if (!breaker.canExecute()) {
      logger.warn("Primary RPC circuit breaker OPEN — skipping to secondary endpoint", {
        endpoint: url,
        cooldownRemainingMs: breaker.getCooldownRemainingMs(),
      });
      continue;
    }

    try {
      const server = await getWorkingRpcServer(network);
      return { server, endpoint: url };
    } catch (err) {
      breaker.recordFailure(err);
      logger.warn("RPC endpoint connection attempt failed", { endpoint: url, error: err });
    }
  }

  // If all candidate endpoints fail circuit checks, fallback to failover's last resort
  const fallbackServer = await getWorkingRpcServer(network);
  return { server: fallbackServer, endpoint: urls[0] ?? "unknown" };
}

/**
 * Executes a Soroban RPC operation with automated circuit breaking and secondary failover.
 * If the active endpoint fails consecutively or trips its circuit, automatically invokes
 * secondary fallback endpoints.
 */
export async function executeRpcWithCircuitBreaker<T>(
  operation: (server: rpc.Server) => Promise<T>,
  network: "TESTNET" | "PUBLIC" = "TESTNET",
  config?: CircuitBreakerConfig
): Promise<T> {
  const urls = getRpcUrls(network);
  let lastError: unknown = null;

  for (const url of urls) {
    const breaker = getCircuitBreaker(url, config);
    if (!breaker.canExecute()) {
      continue;
    }

    try {
      return await breaker.execute(async () => {
        const { server } = await getProtectedRpcServer(network, config);
        return await operation(server);
      });
    } catch (err) {
      lastError = err;
      logger.warn("RPC operation failed with endpoint, attempting fallback", {
        endpoint: url,
        error: err,
      });
    }
  }

  throw lastError ?? new Error("All Soroban RPC endpoints failed or circuits are open");
}

/**
 * Returns comprehensive health status combining RPC failover state and circuit breaker snapshots.
 */
export function getRpcHealthSnapshot(
  network: "TESTNET" | "PUBLIC" = "TESTNET"
): {
  failover: RpcFailoverState;
  circuitBreakers: Record<string, CircuitBreakerSnapshot>;
} {
  const urls = getRpcUrls(network);
  const circuitBreakers: Record<string, CircuitBreakerSnapshot> = {};

  for (const url of urls) {
    circuitBreakers[url] = getCircuitBreaker(url).getSnapshot();
  }

  return {
    failover: getRpcFailoverState(),
    circuitBreakers,
  };
}
