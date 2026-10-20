// SPDX-License-Identifier: MIT

/**
 * Robust Stellar / Soroban RPC Client Layer with Circuit Breaking & Failover (Issue #1421).
 *
 * Connects to configured Soroban RPC and Horizon endpoints with automated failover:
 *
 * • Wraps RPC executions with `RpcCircuitBreaker` (Closed / Open / Half-Open).
 * • When primary endpoint encounters 5 consecutive HTTP 500s or timeouts,
 *   its circuit trips OPEN.
 * • Subsequent requests immediately fail over to secondary RPC providers,
 *   preventing API thread starvation and request timeout cascades.
 * • Sends lightweight probe queries (`getLatestLedger`) to test provider recovery
 *   and automatically returns the circuit to CLOSED when healthy.
 */

import { rpc } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import {
  rpcCircuitBreaker,
  RpcCircuitOpenError,
  type EndpointSnapshot,
} from "@/lib/rpc-circuit-breaker";
import {
  STELLAR_NETWORK,
  SOROBAN_RPC_URL,
} from "@/lib/stellar";
import { getSorobanTimeoutMs } from "@/lib/timeout";

export const DEFAULT_FALLBACK_RPC_URLS: Record<"TESTNET" | "PUBLIC", string[]> = {
  TESTNET: [
    "https://soroban-testnet.stellar.org:443",
    "https://rpc-futurenet.stellar.org:443",
    "https://testnet.soroban.rpc.pulse.so:443",
  ],
  PUBLIC: [
    "https://soroban.stellar.org:443",
    "https://mainnet.soroban.rpc.pulse.so:443",
    "https://horizon.stellar.org",
  ],
};

export function getRpcEndpoints(network: "TESTNET" | "PUBLIC" = STELLAR_NETWORK): string[] {
  const envFallbacks = process.env.STELLAR_RPC_FALLBACK_URLS
    ? process.env.STELLAR_RPC_FALLBACK_URLS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const defaults = DEFAULT_FALLBACK_RPC_URLS[network] || DEFAULT_FALLBACK_RPC_URLS.TESTNET;
  const primary = SOROBAN_RPC_URL || defaults[0];

  const candidateList = [primary, ...envFallbacks, ...defaults];
  const uniqueUrls: string[] = [];
  for (const url of candidateList) {
    if (!uniqueUrls.includes(url)) {
      uniqueUrls.push(url);
    }
  }
  return uniqueUrls;
}

export interface RpcExecutionResult<T> {
  result: T;
  endpoint: string;
  failedOver: boolean;
  attempts: number;
}

export class StellarRpcClient {
  private readonly circuitBreaker = rpcCircuitBreaker;

  /**
   * Create a configured Stellar RPC Server instance for an endpoint URL.
   */
  public createServer(endpointUrl: string): rpc.Server {
    return new rpc.Server(endpointUrl, {
      allowHttp: false,
      timeout: getSorobanTimeoutMs(),
    });
  }

  /**
   * Execute an RPC operation with automatic circuit breaking and secondary failover.
   *
   * Iterates through candidate endpoints:
   * 1. Attempts execution against the primary endpoint.
   * 2. If the primary circuit is OPEN or throws consecutive failures tripping it,
   *    fails over to the next available secondary endpoint without stalling threads.
   * 3. Returns the execution result along with metadata.
   */
  public async executeWithFailover<T>(
    operation: (server: rpc.Server, endpointUrl: string) => Promise<T>,
    network: "TESTNET" | "PUBLIC" = STELLAR_NETWORK
  ): Promise<RpcExecutionResult<T>> {
    const endpoints = getRpcEndpoints(network);
    const errors: Array<{ endpoint: string; error: unknown }> = [];
    let attempts = 0;

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      const isPrimary = i === 0;

      // Fail-fast check on circuit state
      if (!this.circuitBreaker.canExecute(endpoint)) {
        errors.push({
          endpoint,
          error: new RpcCircuitOpenError(endpoint, 30_000),
        });
        continue;
      }

      attempts++;
      try {
        const server = this.createServer(endpoint);
        const result = await this.circuitBreaker.execute(
          async () => operation(server, endpoint),
          endpoint
        );

        if (!isPrimary) {
          logger.warn("Stellar RPC: served request from secondary fallback endpoint", {
            fallbackEndpoint: endpoint,
            primaryEndpoint: endpoints[0],
            attempts,
          });
        }

        return {
          result,
          endpoint,
          failedOver: !isPrimary,
          attempts,
        };
      } catch (err) {
        errors.push({ endpoint, error: err });
        logger.warn("Stellar RPC: endpoint call failed, attempting failover", {
          failedEndpoint: endpoint,
          attempt: attempts,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue loop to failover to next secondary endpoint
      }
    }

    // If all endpoints failed or circuits are open
    const errorDetails = errors
      .map((e) => `${e.endpoint}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
      .join("; ");
    throw new Error(
      `All Soroban RPC endpoints failed or circuits are OPEN. Outage details: [${errorDetails}]`
    );
  }

  /**
   * Probe an RPC endpoint for recovery using a lightweight query (`getLatestLedger`).
   * When the probe succeeds, records success in the circuit breaker, restoring CLOSED state.
   */
  public async probeEndpointRecovery(
    endpointUrl: string,
    customProbeFn?: () => Promise<boolean>
  ): Promise<boolean> {
    const probe = customProbeFn || (async () => {
      try {
        const server = new rpc.Server(endpointUrl, {
          allowHttp: false,
          timeout: 3000,
        });
        const ledger = await server.getLatestLedger();
        return Boolean(ledger && typeof ledger.sequence === "number");
      } catch {
        return false;
      }
    });

    return this.circuitBreaker.probeRecovery(endpointUrl, probe);
  }

  /**
   * Retrieve circuit breaker diagnostic snapshot across all known RPC endpoints.
   */
  public getHealthSummary(network: "TESTNET" | "PUBLIC" = STELLAR_NETWORK): {
    status: "ok" | "degraded" | "error";
    primary: string;
    endpoints: Record<string, EndpointSnapshot>;
    availableCount: number;
    totalCount: number;
  } {
    const endpoints = getRpcEndpoints(network);
    const snapshots: Record<string, EndpointSnapshot> = {};
    let availableCount = 0;

    for (const url of endpoints) {
      const snap = this.circuitBreaker.getEndpointSnapshot(url);
      snapshots[url] = snap;
      if (snap.isAvailable) {
        availableCount++;
      }
    }

    const primarySnap = snapshots[endpoints[0]];
    let status: "ok" | "degraded" | "error" = "ok";

    if (availableCount === 0) {
      status = "error";
    } else if (primarySnap && primarySnap.state === "OPEN") {
      status = "degraded";
    }

    return {
      status,
      primary: endpoints[0],
      endpoints: snapshots,
      availableCount,
      totalCount: endpoints.length,
    };
  }
}

/** Global singleton client instance */
export const stellarRpcClient = new StellarRpcClient();

export async function executeSorobanRpc<T>(
  operation: (server: rpc.Server, endpointUrl: string) => Promise<T>,
  network?: "TESTNET" | "PUBLIC"
): Promise<RpcExecutionResult<T>> {
  return stellarRpcClient.executeWithFailover(operation, network);
}
