// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incCircuitBreakerTrips } from "@/lib/metrics-counters";
import { getFailoverProbeTimeoutMs } from "@/lib/timeout";

/**
 * Soroban RPC Circuit Breaker & Health Probe Fallback (issue #1421).
 *
 * Implements the Circuit Breaker pattern (Closed, Open, Half-Open):
 *   • CLOSED: All traffic targets the primary RPC provider.
 *   • OPEN: After 5 consecutive failures (HTTP 500s or timeouts), the circuit
 *     trips Open. Requests immediately fail over to secondary RPC URLs without
 *     waiting on timeout-prone primary calls, preventing thread starvation.
 *   • HALF-OPEN: After a 30-second cooldown, lightweight health probes
 *     (`getLatestLedger`) test primary provider recovery before resuming
 *     standard routing.
 */

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 30_000;

export const DEFAULT_PRIMARY_RPC =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org:443";

export const DEFAULT_SECONDARY_RPCS = [
  "https://rpc-futurenet.stellar.org:443",
  "https://soroban.stellar.org:443",
];

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  activeEndpoint: string;
  primaryEndpoint: string;
  secondaryEndpoints: string[];
  usingFallback: boolean;
  tripsTotal: number;
  lastTrippedAt: number | null;
  lastRecoveredAt: number | null;
}

export class RpcCircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private lastTrippedAt: number | null = null;
  private lastRecoveredAt: number | null = null;
  private tripsTotal = 0;

  private primaryEndpoint: string;
  private secondaryEndpoints: string[];
  private activeEndpoint: string;
  private secondaryIndex = 0;

  constructor(
    primary: string = DEFAULT_PRIMARY_RPC,
    secondaries: string[] = DEFAULT_SECONDARY_RPCS
  ) {
    this.primaryEndpoint = primary;
    this.secondaryEndpoints = secondaries.length > 0 ? secondaries : [primary];
    this.activeEndpoint = primary;
  }

  public getState(): CircuitBreakerState {
    this.checkCooldownTransition();
    return this.state;
  }

  public getSnapshot(): CircuitBreakerSnapshot {
    this.checkCooldownTransition();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
      activeEndpoint: this.activeEndpoint,
      primaryEndpoint: this.primaryEndpoint,
      secondaryEndpoints: [...this.secondaryEndpoints],
      usingFallback: this.activeEndpoint !== this.primaryEndpoint,
      tripsTotal: this.tripsTotal,
      lastTrippedAt: this.lastTrippedAt,
      lastRecoveredAt: this.lastRecoveredAt,
    };
  }

  /**
   * Evaluates whether an OPEN circuit has passed its cooldown period
   * and should enter HALF_OPEN state.
   */
  private checkCooldownTransition(): void {
    if (this.state === "OPEN" && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= CIRCUIT_COOLDOWN_MS) {
        this.state = "HALF_OPEN";
        logger.info("RPC circuit breaker entering HALF-OPEN state (cooldown expired)", {
          primaryEndpoint: this.primaryEndpoint,
          cooldownMs: CIRCUIT_COOLDOWN_MS,
        });
      }
    }
  }

  /**
   * Returns the current healthy RPC endpoint to route requests to.
   * If OPEN or HALF-OPEN, returns the current secondary fallback endpoint.
   */
  public getActiveEndpoint(): string {
    this.checkCooldownTransition();

    if (this.state === "OPEN" || this.state === "HALF_OPEN") {
      return this.activeEndpoint;
    }

    return this.primaryEndpoint;
  }

  /**
   * Records a successful execution on an endpoint.
   */
  public recordSuccess(endpoint: string): void {
    if (endpoint === this.primaryEndpoint) {
      if (this.state === "HALF_OPEN") {
        this.state = "CLOSED";
        this.consecutiveFailures = 0;
        this.openedAt = null;
        this.lastRecoveredAt = Date.now();
        this.activeEndpoint = this.primaryEndpoint;
        logger.info("RPC circuit breaker CLOSED: primary endpoint recovered", {
          endpoint,
        });
      } else if (this.state === "CLOSED") {
        this.consecutiveFailures = 0;
      }
    }
  }

  /**
   * Records a failure (HTTP 500, timeout, network error) on an endpoint.
   */
  public recordFailure(endpoint: string, err?: unknown): void {
    const errorMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");

    if (endpoint === this.primaryEndpoint) {
      if (this.state === "HALF_OPEN") {
        // Probe or request during HALF_OPEN failed -> immediately re-trip to OPEN
        this.tripOpen(`Primary endpoint probe failed during HALF-OPEN: ${errorMsg}`);
        return;
      }

      this.consecutiveFailures += 1;
      logger.warn("RPC primary endpoint error recorded", {
        endpoint,
        consecutiveFailures: this.consecutiveFailures,
        threshold: CIRCUIT_FAILURE_THRESHOLD,
        error: errorMsg,
      });

      if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && this.state === "CLOSED") {
        this.tripOpen(`Reached ${this.consecutiveFailures} consecutive failures: ${errorMsg}`);
      }
    } else {
      // Failure on a secondary endpoint: rotate to the next available fallback
      if (this.secondaryEndpoints.length > 1) {
        this.secondaryIndex = (this.secondaryIndex + 1) % this.secondaryEndpoints.length;
        this.activeEndpoint = this.secondaryEndpoints[this.secondaryIndex]!;
        logger.warn("Secondary RPC endpoint failed, rotating to next fallback", {
          previousEndpoint: endpoint,
          newEndpoint: this.activeEndpoint,
        });
      }
    }
  }

  /**
   * Trips the circuit breaker to OPEN state, increments metrics, and fails over.
   */
  private tripOpen(reason: string): void {
    this.state = "OPEN";
    this.openedAt = Date.now();
    this.lastTrippedAt = this.openedAt;
    this.tripsTotal += 1;
    incCircuitBreakerTrips(1);

    // Fail over to the first secondary endpoint
    this.activeEndpoint = this.secondaryEndpoints[this.secondaryIndex] ?? this.primaryEndpoint;

    logger.error("RPC circuit breaker TRIPPED to OPEN state", {
      reason,
      primaryEndpoint: this.primaryEndpoint,
      fallbackEndpoint: this.activeEndpoint,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
      tripsTotal: this.tripsTotal,
    });
  }

  /**
   * Sends a lightweight health probe (`getLatestLedger`) to test primary provider recovery.
   */
  public async probePrimaryRecovery(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getFailoverProbeTimeoutMs());

    try {
      const res = await fetch(this.primaryEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const body = (await res.json()) as { error?: unknown; result?: { sequence?: number } };
        if (!body.error && body.result && typeof body.result.sequence === "number") {
          this.recordSuccess(this.primaryEndpoint);
          return true;
        }
      }

      this.recordFailure(this.primaryEndpoint, `Probe HTTP ${res.status}`);
      return false;
    } catch (probeErr) {
      this.recordFailure(this.primaryEndpoint, probeErr);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Resets internal breaker state (intended for testing).
   */
  public resetForTest(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.lastTrippedAt = null;
    this.lastRecoveredAt = null;
    this.tripsTotal = 0;
    this.secondaryIndex = 0;
    this.activeEndpoint = this.primaryEndpoint;
  }
}

// ── Global Singleton Instance ──────────────────────────────────
export const rpcCircuitBreaker = new RpcCircuitBreaker();

export function getCircuitBreakerState(): CircuitBreakerSnapshot {
  return rpcCircuitBreaker.getSnapshot();
}

export function resetCircuitBreakerForTest(): void {
  rpcCircuitBreaker.resetForTest();
}
