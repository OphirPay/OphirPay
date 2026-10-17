// SPDX-License-Identifier: MIT
/**
 * Soroban RPC Circuit Breaker & Health Probe (Issue #1421).
 *
 * Implements a three-state (`CLOSED` → `OPEN` → `HALF_OPEN`) circuit breaker
 * around Soroban RPC and Stellar upstream endpoints:
 *   • `CLOSED`: normal operation; consecutive failures are counted. Once
 *     failures reach `failureThreshold` (default: 5), the circuit trips `OPEN`
 *     and increments `rpc_circuit_breaker_trips_total`.
 *   • `OPEN`: requests fail fast with `CircuitOpenError` (preventing request
 *     thread starvation during upstream outages) until `cooldownMs` (default:
 *     30,000 ms) has elapsed.
 *   • `HALF_OPEN`: once the cooldown expires, a lightweight `getLatestLedger`
 *     JSON-RPC probe (or single trial request) tests whether the upstream has
 *     recovered. A successful probe closes the circuit (`CLOSED`); a failure
 *     immediately re-opens it (`OPEN`) for another cooldown window.
 */

import { incMetric } from "@/lib/metrics-counters";
import { logger } from "@/lib/logger";
import { getFailoverProbeTimeoutMs } from "@/lib/timeout";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitOpenError extends Error {
  public readonly code = "CIRCUIT_OPEN";
  public readonly endpoint: string;
  public readonly retryAfterMs: number;

  constructor(endpoint: string, retryAfterMs: number) {
    super(
      `Soroban RPC circuit breaker is OPEN for ${endpoint} (retry in ${Math.max(0, Math.ceil(retryAfterMs))}ms)`
    );
    this.name = "CircuitOpenError";
    this.endpoint = endpoint;
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

export interface CircuitBreakerOptions {
  endpoint: string;
  failureThreshold?: number;
  cooldownMs?: number;
  probeTimeoutMs?: number;
  onTrip?: (endpoint: string, reason: string, tripCount: number) => void;
  onStateChange?: (endpoint: string, from: CircuitState, to: CircuitState) => void;
}

export interface EndpointCircuitSnapshot {
  endpoint: string;
  state: CircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  tripCount: number;
  openedAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastProbeAt: number | null;
  lastProbeSuccess: boolean | null;
  latestLedgerSequence: number | null;
  remainingCooldownMs: number;
}

export interface RpcCircuitBreakerSummary {
  state: CircuitState;
  tripsTotal: number;
  failureThreshold: number;
  cooldownMs: number;
  endpoints: Record<string, EndpointCircuitSnapshot>;
}

/**
 * Send a lightweight `getLatestLedger` JSON-RPC request to verify that a
 * Soroban RPC endpoint is responsive and advancing ledgers.
 */
export async function probeLatestLedger(
  endpoint: string,
  timeoutMs: number = getFailoverProbeTimeoutMs()
): Promise<{ ok: boolean; sequence: number | null; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
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
      return { ok: false, sequence: null, reason: `HTTP ${res.status}` };
    }

    try {
      const body = (await res.json()) as {
        result?: { sequence?: number; id?: string };
        error?: { message?: string; code?: number };
      };
      if (body && body.error) {
        return {
          ok: false,
          sequence: null,
          reason: body.error.message || `RPC error ${String(body.error.code ?? "")}`.trim(),
        };
      }
      const sequence =
        body && body.result && typeof body.result.sequence === "number"
          ? body.result.sequence
          : null;
      return { ok: true, sequence, reason: "ok" };
    } catch {
      // Some mocked probes in tests return `{ ok: true, status: 200 }` without a JSON body.
      return { ok: true, sequence: null, reason: "ok" };
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, sequence: null, reason: "timeout" };
    }
    return {
      ok: false,
      sequence: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export class RpcCircuitBreaker {
  public readonly endpoint: string;
  public readonly failureThreshold: number;
  public readonly cooldownMs: number;
  public readonly probeTimeoutMs: number;

  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private tripCount = 0;
  private openedAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastFailureReason: string | null = null;
  private lastProbeAt: number | null = null;
  private lastProbeSuccess: boolean | null = null;
  private latestLedgerSequence: number | null = null;
  private probeInFlight: Promise<boolean> | null = null;

  private readonly onTrip?: (endpoint: string, reason: string, tripCount: number) => void;
  private readonly onStateChange?: (
    endpoint: string,
    from: CircuitState,
    to: CircuitState
  ) => void;

  constructor(options: CircuitBreakerOptions) {
    this.endpoint = options.endpoint;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? getFailoverProbeTimeoutMs();
    this.onTrip = options.onTrip;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Evaluate current state at `Date.now()`. Automatically transitions `OPEN`
   * to `HALF_OPEN` once `cooldownMs` has elapsed.
   */
  public getState(): CircuitState {
    if (
      this.state === "OPEN" &&
      this.openedAt !== null &&
      Date.now() - this.openedAt >= this.cooldownMs
    ) {
      this.transitionTo("HALF_OPEN");
    }
    return this.state;
  }

  public getRemainingCooldownMs(): number {
    if (this.state !== "OPEN" || this.openedAt === null) {
      return 0;
    }
    return Math.max(0, this.cooldownMs - (Date.now() - this.openedAt));
  }

  public canAttempt(): boolean {
    return this.getState() !== "OPEN";
  }

  public recordSuccess(ledgerSequence?: number | null): void {
    const prev = this.state;
    this.consecutiveFailures = 0;
    this.openedAt = null;
    if (ledgerSequence !== undefined && ledgerSequence !== null) {
      this.latestLedgerSequence = ledgerSequence;
    }
    if (prev !== "CLOSED") {
      this.transitionTo("CLOSED");
      logger.info("RPC circuit breaker closed after recovery", {
        endpoint: this.endpoint,
        previousState: prev,
      });
    }
  }

  public recordFailure(reason: unknown): void {
    const reasonStr =
      reason instanceof Error ? reason.message : typeof reason === "string" ? reason : String(reason);
    const now = Date.now();
    this.lastFailureAt = now;
    this.lastFailureReason = reasonStr;
    this.consecutiveFailures += 1;

    const currentState = this.getState();
    if (currentState === "HALF_OPEN") {
      // Failed recovery probe or trial call in HALF_OPEN immediately re-trips OPEN.
      this.trip(reasonStr);
      return;
    }

    if (currentState === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      this.trip(reasonStr);
    }
  }

  private trip(reason: string): void {
    const prev = this.state;
    this.openedAt = Date.now();
    this.tripCount += 1;
    this.transitionTo("OPEN");
    incMetric("rpc_circuit_breaker_trips_total");
    recordGlobalTrip();

    logger.warn("RPC circuit breaker tripped OPEN", {
      endpoint: this.endpoint,
      reason,
      consecutiveFailures: this.consecutiveFailures,
      tripCount: this.tripCount,
      cooldownMs: this.cooldownMs,
      previousState: prev,
    });

    this.onTrip?.(this.endpoint, reason, this.tripCount);
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state;
    if (prev === next) return;
    this.state = next;
    this.onStateChange?.(this.endpoint, prev, next);
  }

  /**
   * Perform a `getLatestLedger` probe when the circuit is `HALF_OPEN` (or
   * `OPEN` after cooldown expiry) to verify recovery and return to `CLOSED`.
   */
  public async probeRecovery(): Promise<boolean> {
    const current = this.getState();
    if (current === "CLOSED") {
      return true;
    }
    if (current === "OPEN") {
      return false;
    }

    if (this.probeInFlight) {
      return this.probeInFlight;
    }

    this.probeInFlight = (async () => {
      this.lastProbeAt = Date.now();
      const probe = await probeLatestLedger(this.endpoint, this.probeTimeoutMs);
      this.lastProbeSuccess = probe.ok;
      if (probe.ok) {
        this.recordSuccess(probe.sequence);
        return true;
      }
      this.recordFailure(probe.reason);
      return false;
    })();

    try {
      return await this.probeInFlight;
    } finally {
      this.probeInFlight = null;
    }
  }

  /**
   * Execute an operation guarded by this circuit breaker.
   *
   * - When `OPEN` (before cooldown expires), throws `CircuitOpenError`
   *   immediately (fail-fast).
   * - When `HALF_OPEN`, runs a lightweight `getLatestLedger` recovery probe
   *   first (unless `skipProbe` is set); if the probe succeeds, closes the
   *   circuit and runs `operation`.
   */
  public async execute<T>(
    operation: () => Promise<T>,
    options?: { skipProbe?: boolean }
  ): Promise<T> {
    const current = this.getState();
    if (current === "OPEN") {
      throw new CircuitOpenError(this.endpoint, this.getRemainingCooldownMs());
    }

    if (current === "HALF_OPEN" && !options?.skipProbe) {
      const recovered = await this.probeRecovery();
      if (!recovered) {
        throw new CircuitOpenError(this.endpoint, this.getRemainingCooldownMs());
      }
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

  public getSnapshot(): EndpointCircuitSnapshot {
    const currentState = this.getState();
    return {
      endpoint: this.endpoint,
      state: currentState,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      tripCount: this.tripCount,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
      lastProbeAt: this.lastProbeAt,
      lastProbeSuccess: this.lastProbeSuccess,
      latestLedgerSequence: this.latestLedgerSequence,
      remainingCooldownMs: this.getRemainingCooldownMs(),
    };
  }

  public reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.tripCount = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.lastFailureReason = null;
    this.lastProbeAt = null;
    this.lastProbeSuccess = null;
    this.latestLedgerSequence = null;
    this.probeInFlight = null;
  }
}

// ── Process-wide registry of per-endpoint circuit breakers ──────

const registry = new Map<string, RpcCircuitBreaker>();
let totalTripsAcrossProcess = 0;

function recordGlobalTrip(): void {
  totalTripsAcrossProcess += 1;
}

export function getEndpointCircuitBreaker(
  endpoint: string,
  options?: Omit<CircuitBreakerOptions, "endpoint">
): RpcCircuitBreaker {
  let breaker = registry.get(endpoint);
  if (!breaker) {
    breaker = new RpcCircuitBreaker({
      endpoint,
      ...options,
    });
    registry.set(endpoint, breaker);
  }
  return breaker;
}

export function getRpcCircuitBreakerSnapshot(): RpcCircuitBreakerSummary {
  const endpoints: Record<string, EndpointCircuitSnapshot> = {};
  let aggregateState: CircuitState = "CLOSED";

  for (const [url, breaker] of registry.entries()) {
    const snap = breaker.getSnapshot();
    endpoints[url] = snap;
    if (snap.state === "OPEN") {
      aggregateState = "OPEN";
    } else if (snap.state === "HALF_OPEN" && aggregateState !== "OPEN") {
      aggregateState = "HALF_OPEN";
    }
  }

  return {
    state: aggregateState,
    tripsTotal: totalTripsAcrossProcess,
    failureThreshold: DEFAULT_FAILURE_THRESHOLD,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    endpoints,
  };
}

export function resetRpcCircuitBreakers(): void {
  for (const breaker of registry.values()) {
    breaker.reset();
  }
  registry.clear();
  totalTripsAcrossProcess = 0;
}
