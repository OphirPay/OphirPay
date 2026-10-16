// SPDX-License-Identifier: MIT

/**
 * Soroban RPC Circuit Breaker & Health State Manager (Issue #1421).
 *
 * Implements a strict Circuit Breaker pattern (Closed, Open, Half-Open)
 * protecting against Soroban and Horizon RPC outages, network timeouts,
 * and 5xx cascades:
 *
 * • CLOSED: Normal operation. Requests flow through. Failures increment a consecutive
 *   failure counter.
 * • OPEN: Tripped when consecutive failures reach `failureThreshold` (default: 5).
 *   Subsequent requests fail fast immediately with `RpcCircuitOpenError`, preventing
 *   thread/worker starvation and upstream timeout pile-ups.
 * • HALF_OPEN: Entered automatically after `cooldownMs` (default: 30 s). Allows trial
 *   or probe requests to test provider recovery. A single success restores CLOSED;
 *   any failure immediately trips back to OPEN.
 * • Metrics & Observability: Every trip to OPEN increments the Prometheus counter
 *   `rpc_circuit_breaker_trips_total` and logs endpoint transition diagnostics.
 */

import { logger } from "@/lib/logger";
import { incMetric } from "@/lib/metrics-counters";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before tripping to OPEN (default: 5). */
  failureThreshold: number;
  /** Cooldown duration in ms before moving from OPEN to HALF_OPEN (default: 30,000 ms). */
  cooldownMs: number;
  /** Probe query timeout in ms (default: 3,000 ms). */
  probeTimeoutMs: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  probeTimeoutMs: 3_000,
};

export class RpcCircuitOpenError extends Error {
  public readonly code = "RPC_CIRCUIT_OPEN";

  constructor(
    public readonly endpoint: string,
    public readonly retryAfterMs: number
  ) {
    const retrySec = Math.ceil(retryAfterMs / 1000);
    super(
      `RPC circuit breaker is OPEN for endpoint ${endpoint}. Rapidly rejecting call to prevent thread starvation. Cooldown expires in ${retrySec}s.`
    );
    this.name = "RpcCircuitOpenError";
  }
}

export interface EndpointSnapshot {
  endpoint: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastFailureReason: string | null;
  trippedAt: number | null;
  isAvailable: boolean;
}

interface EndpointStateInternal {
  endpoint: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastFailureReason: string | null;
  trippedAt: number | null;
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

export class RpcCircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly circuits = new Map<string, EndpointStateInternal>();

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  private getOrCreate(endpoint: string): EndpointStateInternal {
    let state = this.circuits.get(endpoint);
    if (!state) {
      state = {
        endpoint,
        state: "CLOSED",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastFailureReason: null,
        trippedAt: null,
      };
      this.circuits.set(endpoint, state);
    }
    return state;
  }

  /**
   * Determine whether an endpoint is permitted to execute requests.
   * Handles cooldown evaluation and transition from OPEN -> HALF_OPEN.
   */
  public canExecute(endpoint: string, now: number = Date.now()): boolean {
    const ep = this.getOrCreate(endpoint);

    if (ep.state === "OPEN") {
      const elapsed = ep.trippedAt !== null ? now - ep.trippedAt : 0;
      if (elapsed >= this.config.cooldownMs) {
        ep.state = "HALF_OPEN";
        logger.info("RPC circuit breaker: entering HALF_OPEN probe state", {
          endpoint,
          cooldownMs: this.config.cooldownMs,
          elapsedMs: elapsed,
        });
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Execute an async operation protected by the circuit breaker.
   * If the circuit is OPEN, throws RpcCircuitOpenError immediately without waiting for timeouts.
   */
  public async execute<T>(
    fn: () => Promise<T>,
    endpoint: string,
    now: number = Date.now()
  ): Promise<T> {
    if (!this.canExecute(endpoint, now)) {
      const ep = this.getOrCreate(endpoint);
      const elapsed = ep.trippedAt !== null ? now - ep.trippedAt : 0;
      const retryAfterMs = Math.max(0, this.config.cooldownMs - elapsed);
      throw new RpcCircuitOpenError(endpoint, retryAfterMs);
    }

    try {
      const result = await fn();
      this.recordSuccess(endpoint, now);
      return result;
    } catch (err) {
      this.recordFailure(endpoint, err, now);
      throw err;
    }
  }

  /**
   * Record a successful response from the endpoint.
   * Transitions HALF_OPEN -> CLOSED and resets consecutive failures.
   */
  public recordSuccess(endpoint: string, now: number = Date.now()): void {
    const ep = this.getOrCreate(endpoint);
    ep.lastSuccessAt = now;
    ep.consecutiveSuccesses += 1;

    if (ep.state === "HALF_OPEN" || ep.state === "OPEN") {
      logger.info("RPC circuit breaker: health restored -> CLOSED", {
        endpoint,
        previousFailures: ep.consecutiveFailures,
      });
      ep.state = "CLOSED";
      ep.consecutiveFailures = 0;
      ep.trippedAt = null;
      ep.lastFailureReason = null;
    } else if (ep.state === "CLOSED") {
      ep.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failure on the endpoint.
   * Trips CLOSED -> OPEN when consecutive failures reach threshold.
   * Immediately trips HALF_OPEN -> OPEN upon any probe failure.
   */
  public recordFailure(endpoint: string, err?: unknown, now: number = Date.now()): void {
    const ep = this.getOrCreate(endpoint);
    const reason = reasonFromError(err);
    ep.lastFailureAt = now;
    ep.lastFailureReason = reason;
    ep.consecutiveFailures += 1;
    ep.consecutiveSuccesses = 0;

    if (ep.state === "HALF_OPEN") {
      ep.state = "OPEN";
      ep.trippedAt = now;
      incMetric("rpc_circuit_breaker_trips_total");
      logger.warn("RPC circuit breaker: probe failed in HALF_OPEN -> re-tripping to OPEN", {
        endpoint,
        reason,
        cooldownMs: this.config.cooldownMs,
      });
    } else if (ep.state === "OPEN") {
      ep.trippedAt = now;
      logger.warn("RPC circuit breaker: failure recorded while OPEN -> refreshing cooldown", {
        endpoint,
        reason,
        cooldownMs: this.config.cooldownMs,
      });
    } else if (ep.state === "CLOSED" && ep.consecutiveFailures >= this.config.failureThreshold) {
      ep.state = "OPEN";
      ep.trippedAt = now;
      incMetric("rpc_circuit_breaker_trips_total");
      logger.warn("RPC circuit breaker: failure threshold reached -> tripping to OPEN", {
        endpoint,
        consecutiveFailures: ep.consecutiveFailures,
        threshold: this.config.failureThreshold,
        reason,
        cooldownMs: this.config.cooldownMs,
      });
    }
  }

  /**
   * Perform an explicit probe query (e.g. getLatestLedger) to test endpoint recovery.
   * If the probe succeeds, resets the circuit to CLOSED.
   */
  public async probeRecovery(
    endpoint: string,
    probeFn: () => Promise<boolean>,
    now: number = Date.now()
  ): Promise<boolean> {
    try {
      const ok = await probeFn();
      if (ok) {
        this.recordSuccess(endpoint, now);
        return true;
      }
      this.recordFailure(endpoint, new Error("Probe verification returned false"), now);
      return false;
    } catch (err) {
      this.recordFailure(endpoint, err, now);
      return false;
    }
  }

  /**
   * Get observable snapshot of an endpoint's circuit status.
   */
  public getEndpointSnapshot(endpoint: string, now: number = Date.now()): EndpointSnapshot {
    // Calling canExecute ensures OPEN -> HALF_OPEN transitions are evaluated
    this.canExecute(endpoint, now);
    const ep = this.getOrCreate(endpoint);
    return {
      endpoint: ep.endpoint,
      state: ep.state,
      consecutiveFailures: ep.consecutiveFailures,
      consecutiveSuccesses: ep.consecutiveSuccesses,
      lastFailureAt: ep.lastFailureAt,
      lastSuccessAt: ep.lastSuccessAt,
      lastFailureReason: ep.lastFailureReason,
      trippedAt: ep.trippedAt,
      isAvailable: ep.state !== "OPEN",
    };
  }

  /**
   * Get snapshot of all tracked endpoint circuits.
   */
  public getAllStates(now: number = Date.now()): Record<string, EndpointSnapshot> {
    const result: Record<string, EndpointSnapshot> = {};
    for (const [url] of this.circuits) {
      result[url] = this.getEndpointSnapshot(url, now);
    }
    return result;
  }

  /**
   * Reset tracking state (useful between tests or operational manual override).
   */
  public reset(endpoint?: string): void {
    if (endpoint) {
      this.circuits.delete(endpoint);
    } else {
      this.circuits.clear();
    }
  }
}

/** Global singleton instance */
export const rpcCircuitBreaker = new RpcCircuitBreaker();

export function getRpcCircuitBreakerState(): Record<string, EndpointSnapshot> {
  return rpcCircuitBreaker.getAllStates();
}

export function resetRpcCircuitBreaker(): void {
  rpcCircuitBreaker.reset();
}
