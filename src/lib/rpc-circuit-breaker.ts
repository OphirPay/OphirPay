// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incRpcCircuitBreakerTrips } from "@/lib/metrics-counters";
import { getFailoverProbeTimeoutMs } from "@/lib/timeout";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before tripping from CLOSED to OPEN (default: 5). */
  failureThreshold?: number;
  /** Duration in milliseconds that the circuit remains OPEN before probing in HALF_OPEN (default: 30,000ms = 30s). */
  cooldownMs?: number;
  /** Timeout in milliseconds for probe queries (default: 3,000ms). */
  probeTimeoutMs?: number;
  /** Number of consecutive successful probes required in HALF_OPEN to close the circuit (default: 1). */
  successThreshold?: number;
}

export interface CircuitBreakerSnapshot {
  endpoint: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastTripAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  cooldownRemainingMs: number;
  tripCount: number;
}

export class RpcCircuitBreakerOpenError extends Error {
  readonly endpoint: string;
  readonly cooldownRemainingMs: number;
  readonly lastFailureReason: string | null;

  constructor(endpoint: string, cooldownRemainingMs: number, lastFailureReason: string | null) {
    super(
      `RPC circuit breaker for ${endpoint} is OPEN (cooldown remaining: ${Math.round(
        cooldownRemainingMs / 1000
      )}s, reason: ${lastFailureReason ?? "unknown"}). Request aborted to prevent thread starvation.`
    );
    this.name = "RpcCircuitBreakerOpenError";
    this.endpoint = endpoint;
    this.cooldownRemainingMs = cooldownRemainingMs;
    this.lastFailureReason = lastFailureReason;
  }
}

export class RpcCircuitBreaker {
  readonly endpoint: string;
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly probeTimeoutMs: number;
  readonly successThreshold: number;

  private internalState: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastTripAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastFailureReason: string | null = null;
  private tripCount = 0;

  constructor(endpoint: string, config: CircuitBreakerConfig = {}) {
    this.endpoint = endpoint;
    this.failureThreshold = config.failureThreshold ?? 5;
    this.cooldownMs = config.cooldownMs ?? 30_000;
    this.probeTimeoutMs = config.probeTimeoutMs ?? getFailoverProbeTimeoutMs() ?? 3_000;
    this.successThreshold = config.successThreshold ?? 1;
  }

  /**
   * Current circuit state with automatic transition from OPEN -> HALF_OPEN
   * once the cooldown window has elapsed.
   */
  getState(): CircuitBreakerState {
    if (this.internalState === "OPEN" && this.lastTripAt !== null) {
      const elapsed = Date.now() - this.lastTripAt;
      if (elapsed >= this.cooldownMs) {
        this.internalState = "HALF_OPEN";
        this.consecutiveSuccesses = 0;
        logger.info("RPC circuit entered HALF_OPEN state — ready for recovery probe", {
          endpoint: this.endpoint,
          elapsedMs: elapsed,
        });
      }
    }
    return this.internalState;
  }

  /**
   * Returns true if requests or probes are permitted to execute.
   * CLOSED allows normal execution, HALF_OPEN allows recovery trial.
   * OPEN fails immediately without attempting upstream requests.
   */
  canExecute(): boolean {
    const state = this.getState();
    return state === "CLOSED" || state === "HALF_OPEN";
  }

  /**
   * Remaining cooldown milliseconds if the circuit is currently OPEN, otherwise 0.
   */
  getCooldownRemainingMs(): number {
    if (this.internalState !== "OPEN" || this.lastTripAt === null) {
      return 0;
    }
    const elapsed = Date.now() - this.lastTripAt;
    return Math.max(0, this.cooldownMs - elapsed);
  }

  /**
   * Record a successful operation or probe against the endpoint.
   */
  recordSuccess(): void {
    const currentState = this.getState();

    if (currentState === "HALF_OPEN") {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.internalState = "CLOSED";
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        logger.info("RPC circuit recovered to CLOSED state after successful probe", {
          endpoint: this.endpoint,
        });
      }
    } else if (currentState === "CLOSED") {
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failed operation or probe against the endpoint.
   */
  recordFailure(err?: unknown): void {
    const now = Date.now();
    this.lastFailureAt = now;
    if (err instanceof Error) {
      this.lastFailureReason = err.message || err.name;
    } else if (err !== undefined) {
      this.lastFailureReason = String(err);
    } else {
      this.lastFailureReason = "Unspecified RPC error";
    }

    const currentState = this.getState();

    if (currentState === "HALF_OPEN") {
      // Any failure during HALF_OPEN immediately re-trips the circuit back to OPEN
      this.internalState = "OPEN";
      this.lastTripAt = now;
      this.tripCount += 1;
      incRpcCircuitBreakerTrips(1);
      logger.warn("RPC recovery probe failed — circuit tripped back to OPEN", {
        endpoint: this.endpoint,
        reason: this.lastFailureReason,
        cooldownMs: this.cooldownMs,
      });
    } else if (currentState === "CLOSED") {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.internalState = "OPEN";
        this.lastTripAt = now;
        this.tripCount += 1;
        incRpcCircuitBreakerTrips(1);
        logger.warn(
          `RPC circuit breaker tripped to OPEN after ${this.consecutiveFailures} consecutive failures`,
          {
            endpoint: this.endpoint,
            reason: this.lastFailureReason,
            threshold: this.failureThreshold,
            cooldownMs: this.cooldownMs,
          }
        );
      }
    }
  }

  /**
   * Executes an asynchronous operation wrapped with circuit breaker protection.
   * Throws RpcCircuitBreakerOpenError immediately if OPEN to prevent thread starvation.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new RpcCircuitBreakerOpenError(
        this.endpoint,
        this.getCooldownRemainingMs(),
        this.lastFailureReason
      );
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  /**
   * Sends a lightweight probe query (`getLatestLedger` or `getHealth`)
   * to test provider reachability and trigger state transitions.
   */
  async probeHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.probeTimeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Fallback to getHealth if getLatestLedger is rejected with HTTP error
        const healthRes = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getHealth",
          }),
          signal: controller.signal,
        });

        if (!healthRes.ok) {
          this.recordFailure(new Error(`HTTP ${healthRes.status}`));
          return false;
        }
      }

      this.recordSuccess();
      return true;
    } catch (err) {
      this.recordFailure(err);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Returns a point-in-time snapshot of the circuit breaker state.
   */
  getSnapshot(): CircuitBreakerSnapshot {
    return {
      endpoint: this.endpoint,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastTripAt: this.lastTripAt,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
      cooldownRemainingMs: this.getCooldownRemainingMs(),
      tripCount: this.tripCount,
    };
  }

  /**
   * Resets the circuit breaker state to CLOSED (useful for testing or manual recovery).
   */
  reset(): void {
    this.internalState = "CLOSED";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastTripAt = null;
    this.lastFailureAt = null;
    this.lastFailureReason = null;
    this.tripCount = 0;
  }
}

// ── Registry of endpoint circuit breakers ───────────────────────

const circuitBreakers = new Map<string, RpcCircuitBreaker>();

/**
 * Gets or creates a circuit breaker for a given RPC endpoint.
 */
export function getCircuitBreaker(
  endpoint: string,
  config?: CircuitBreakerConfig
): RpcCircuitBreaker {
  let breaker = circuitBreakers.get(endpoint);
  if (!breaker) {
    breaker = new RpcCircuitBreaker(endpoint, config);
    circuitBreakers.set(endpoint, breaker);
  }
  return breaker;
}

/**
 * Returns snapshots for all registered RPC circuit breakers.
 */
export function getAllCircuitBreakerSnapshots(): Record<string, CircuitBreakerSnapshot> {
  const result: Record<string, CircuitBreakerSnapshot> = {};
  for (const [endpoint, breaker] of circuitBreakers.entries()) {
    result[endpoint] = breaker.getSnapshot();
  }
  return result;
}

/**
 * Resets all registered circuit breakers.
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
  circuitBreakers.clear();
}
