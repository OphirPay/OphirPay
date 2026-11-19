// SPDX-License-Identifier: MIT

import { rpc } from "@stellar/stellar-sdk";
import {
  rpcCircuitBreaker,
  getCircuitBreakerState,
  type CircuitBreakerSnapshot,
} from "@/lib/rpc-circuit-breaker";
import { getSorobanTimeoutMs, withStellarTimeoutProxy } from "@/lib/timeout";
import { logger } from "@/lib/logger";

/**
 * Resilient Soroban RPC Client with Circuit Breaker and Fallback routing (issue #1421).
 *
 * Automatically directs RPC operations through the active provider selected by the
 * circuit breaker. When 5 consecutive failures occur on the primary node, requests
 * immediately fail over to secondary nodes to prevent thread starvation.
 */

export interface RpcExecutionOptions {
  timeoutMs?: number;
}

/**
 * Creates an rpc.Server instance configured with timeout and error classification.
 */
export function createRpcServerInstance(url: string, timeoutMs?: number): rpc.Server {
  const timeout = timeoutMs ?? getSorobanTimeoutMs();
  const server = new rpc.Server(url, {
    allowHttp: false,
    timeout,
  });
  return withStellarTimeoutProxy(server, timeout, "Soroban RPC");
}

/**
 * Returns an RPC Server instance pointing to the current active endpoint.
 */
export function getResilientRpcServer(): rpc.Server {
  const endpoint = rpcCircuitBreaker.getActiveEndpoint();
  return createRpcServerInstance(endpoint);
}

/**
 * Executes an arbitrary operation with circuit breaker protection and automatic fallback.
 */
export async function executeWithCircuitBreaker<T>(
  operation: (server: rpc.Server) => Promise<T>,
  options: RpcExecutionOptions = {}
): Promise<T> {
  // If the breaker is in HALF_OPEN, test primary recovery first
  if (rpcCircuitBreaker.getState() === "HALF_OPEN") {
    await rpcCircuitBreaker.probePrimaryRecovery();
  }

  const endpoint = rpcCircuitBreaker.getActiveEndpoint();
  const server = createRpcServerInstance(endpoint, options.timeoutMs);

  try {
    const result = await operation(server);
    rpcCircuitBreaker.recordSuccess(endpoint);
    return result;
  } catch (err) {
    rpcCircuitBreaker.recordFailure(endpoint, err);
    logger.warn("RPC operation failed with active circuit breaker", {
      endpoint,
      state: rpcCircuitBreaker.getState(),
      error: err instanceof Error ? err.message : String(err),
    });

    // If the circuit just opened and we were on primary, retry once immediately on fallback
    const state = rpcCircuitBreaker.getState();
    if (state === "OPEN") {
      const fallbackEndpoint = rpcCircuitBreaker.getActiveEndpoint();
      if (fallbackEndpoint !== endpoint) {
        logger.info("Retrying operation on secondary RPC endpoint after circuit trip", {
          fallbackEndpoint,
        });
        const fallbackServer = createRpcServerInstance(fallbackEndpoint, options.timeoutMs);
        try {
          const fallbackResult = await operation(fallbackServer);
          rpcCircuitBreaker.recordSuccess(fallbackEndpoint);
          return fallbackResult;
        } catch (fallbackErr) {
          rpcCircuitBreaker.recordFailure(fallbackEndpoint, fallbackErr);
          throw fallbackErr;
        }
      }
    }

    throw err;
  }
}

/**
 * Fetches the latest ledger sequence from Soroban RPC using the resilient client.
 */
export async function getLatestLedgerWithFallback(): Promise<number> {
  return executeWithCircuitBreaker(async (server) => {
    const response = await server.getLatestLedger();
    return response.sequence;
  });
}

export { rpcCircuitBreaker, getCircuitBreakerState, type CircuitBreakerSnapshot };
