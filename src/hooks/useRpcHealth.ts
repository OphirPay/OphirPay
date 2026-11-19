"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side view of the Soroban RPC health reported by `/api/health`.
 *
 * The health endpoint already probes the active RPC endpoint (through
 * `src/lib/rpc-failover.ts`) and exposes the failover state. This hook turns
 * that snapshot into a small, rolling health model the UI can render:
 *
 *   • the latest latency and the active endpoint / provider,
 *   • an error rate over the last {@link RPC_HEALTH_HISTORY_SIZE} probes,
 *   • a `degraded` flag when the latest probe failed (5xx / 429 / timeout) or
 *     exceeded {@link RPC_HEALTH_LATENCY_THRESHOLD_MS}.
 *
 * A single healthy probe clears the degraded flag again, so the banner
 * disappears as soon as healthy responses resume — no manual dismissal and no
 * hidden "stuck" state.
 */

/** A response slower than this is treated as degraded (issue: RPC UX). */
export const RPC_HEALTH_LATENCY_THRESHOLD_MS = 3000;

/** How often the health endpoint is polled while the app is open. */
export const RPC_HEALTH_POLL_INTERVAL_MS = 15_000;

/** Abort a health request that has not answered within this window. */
export const RPC_HEALTH_REQUEST_TIMEOUT_MS = 8_000;

/** Number of recent probes used to compute the error rate. */
export const RPC_HEALTH_HISTORY_SIZE = 20;

/**
 * Same-origin endpoint that probes RPC + reports failover state.
 * `probe=rpc` selects the lightweight branch (no database/Horizon checks) so
 * polling from the UI stays cheap.
 */
export const RPC_HEALTH_ENDPOINT = "/api/health?probe=rpc";

export type RpcHealthStatus = "unknown" | "healthy" | "degraded";

/** One normalized probe result. */
export interface RpcHealthProbe {
  /** True only when the endpoint answered and reported a healthy RPC. */
  ok: boolean;
  /** Round-trip time the server measured for the RPC, or null when unknown. */
  latencyMs: number | null;
  /** HTTP status of the health request itself (429/5xx mean degraded). */
  httpStatus: number | null;
  /** Endpoint currently serving Soroban calls, per `rpc-failover.ts`. */
  activeEndpoint: string | null;
  /** First configured (primary) endpoint for the network. */
  primaryEndpoint: string | null;
  /** Provider label derived by `rpc-failover.ts` (host name). */
  activeProviderName: string | null;
  /** True while a non-primary endpoint is serving traffic. */
  usingFallback: boolean;
  /** Human-readable reason the probe is not healthy, when applicable. */
  error: string | null;
}

/** State returned by {@link useRpcHealth}. */
export interface RpcHealthSnapshot {
  status: RpcHealthStatus;
  /** Latest measured RPC latency (ms), or null when unknown. */
  latencyMs: number | null;
  /** Average latency across recent successful probes. */
  averageLatencyMs: number | null;
  /** Fraction (0–1) of recent probes that failed. */
  errorRate: number;
  /** Consecutive failed probes since the last healthy one. */
  consecutiveFailures: number;
  /** Active RPC endpoint, per the server-side failover state. */
  activeEndpoint: string | null;
  primaryEndpoint: string | null;
  /** Host name of the active endpoint, for display. */
  activeProviderName: string | null;
  usingFallback: boolean;
  /** When the last probe completed (epoch ms). */
  lastCheckedAt: number | null;
  /** Why the current state is degraded, when it is. */
  error: string | null;
  /** True until the first probe settles. */
  isLoading: boolean;
}

export interface UseRpcHealthOptions {
  /** Disable polling (e.g. in tests or offline mode). Defaults to true. */
  enabled?: boolean;
  /** Override the poll interval. */
  pollIntervalMs?: number;
  /** Override the degraded latency threshold. */
  latencyThresholdMs?: number;
  /** Override the request timeout. */
  requestTimeoutMs?: number;
  /** Override the health endpoint. */
  endpoint?: string;
  /** Injectable fetch implementation (tests). Defaults to global fetch. */
  fetcher?: typeof fetch;
}

const EMPTY_PROBE: RpcHealthProbe = {
  ok: false,
  latencyMs: null,
  httpStatus: null,
  activeEndpoint: null,
  primaryEndpoint: null,
  activeProviderName: null,
  usingFallback: false,
  error: null,
};

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Host name of an endpoint URL, falling back to the raw value. */
export function formatRpcEndpoint(endpoint: string | null): string {
  if (!endpoint) return "";
  try {
    return new URL(endpoint).host || endpoint;
  } catch {
    return endpoint;
  }
}

/**
 * Normalize the `/api/health` envelope into a probe result.
 *
 * The endpoint answers with `{ success, data: { services, rpcFailover } }`.
 * A 5xx/429 response is handled by the caller before parsing; when this runs
 * on a 2xx body, an `rpc.status` of `"error"` is still treated as failed
 * because that is how the health route reports a 5xx/429/timeout from the
 * upstream RPC probe.
 */
export function parseRpcHealthPayload(payload: unknown): RpcHealthProbe {
  const envelope = asRecord(payload);
  const data = asRecord(envelope?.data) ?? envelope;
  if (!data) return { ...EMPTY_PROBE, error: "Malformed health response" };

  const services = asRecord(data.services);
  const stellar = asRecord(services?.stellar);
  const rpc = asRecord(stellar?.rpc);
  const failover = asRecord(data.rpcFailover);

  const latencyMs = asFiniteNumber(rpc?.latencyMs);
  const rpcStatus = typeof rpc?.status === "string" ? rpc.status : null;
  const ok = rpcStatus === "ok" && latencyMs !== null;

  const activeEndpoint =
    (typeof failover?.activeEndpoint === "string"
      ? failover.activeEndpoint
      : null) ??
    (typeof stellar?.rpcUrl === "string" ? stellar.rpcUrl : null);
  const primaryEndpoint =
    typeof failover?.primaryEndpoint === "string"
      ? failover.primaryEndpoint
      : null;
  const activeProviderName =
    typeof failover?.activeProviderName === "string"
      ? failover.activeProviderName
      : formatRpcEndpoint(activeEndpoint) || null;

  return {
    ok,
    latencyMs,
    httpStatus: null,
    activeEndpoint,
    primaryEndpoint,
    activeProviderName,
    usingFallback: failover?.usingFallback === true,
    error: ok
      ? null
      : rpcStatus === "error"
        ? "RPC health check failed"
        : "RPC health unavailable",
  };
}

/** Average of the finite latencies in a window of probes. */
function averageLatency(probes: RpcHealthProbe[]): number | null {
  const values = probes
    .map((probe) => probe.latencyMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Monitor Soroban RPC latency and error rate.
 *
 * The hook polls `/api/health` (which probes the RPC through the failover
 * layer) and exposes a snapshot for a status banner. It never throws: a
 * network failure, timeout, malformed body or 5xx/429 is recorded as a failed
 * probe and surfaces as `status: "degraded"`.
 */
export function useRpcHealth(
  options: UseRpcHealthOptions = {}
): RpcHealthSnapshot & { refresh: () => Promise<void> } {
  const {
    enabled = true,
    pollIntervalMs = RPC_HEALTH_POLL_INTERVAL_MS,
    latencyThresholdMs = RPC_HEALTH_LATENCY_THRESHOLD_MS,
    requestTimeoutMs = RPC_HEALTH_REQUEST_TIMEOUT_MS,
    endpoint = RPC_HEALTH_ENDPOINT,
    fetcher,
  } = options;

  const [snapshot, setSnapshot] = useState<RpcHealthSnapshot>({
    status: "unknown",
    latencyMs: null,
    averageLatencyMs: null,
    errorRate: 0,
    consecutiveFailures: 0,
    activeEndpoint: null,
    primaryEndpoint: null,
    activeProviderName: null,
    usingFallback: false,
    lastCheckedAt: null,
    error: null,
    isLoading: true,
  });

  const historyRef = useRef<RpcHealthProbe[]>([]);
  const consecutiveFailuresRef = useRef(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  // Keep the latest options in refs so changing a callback identity cannot
  // restart the polling loop (and issue an extra probe on every render).
  const fetcherRef = useRef<typeof fetch>(fetcher ?? globalThis.fetch);
  fetcherRef.current = fetcher ?? globalThis.fetch;
  const configRef = useRef({ endpoint, latencyThresholdMs, requestTimeoutMs });
  configRef.current = { endpoint, latencyThresholdMs, requestTimeoutMs };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runProbe = useCallback(async (): Promise<void> => {
    // A manual refresh while a poll is in flight must not stack requests.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const { endpoint: url, latencyThresholdMs: threshold, requestTimeoutMs: timeoutMs } =
      configRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let probe: RpcHealthProbe = { ...EMPTY_PROBE };

    try {
      const response = await fetcherRef.current(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A non-JSON body is handled below as an unhealthy probe.
      }

      if (response.status === 429 || response.status >= 500) {
        const parsed = parseRpcHealthPayload(payload);
        probe = {
          ...parsed,
          ok: false,
          httpStatus: response.status,
          error: `HTTP ${response.status}`,
        };
      } else if (!response.ok) {
        probe = {
          ...EMPTY_PROBE,
          httpStatus: response.status,
          error: `HTTP ${response.status}`,
        };
      } else {
        const parsed = parseRpcHealthPayload(payload);
        probe = { ...parsed, httpStatus: response.status };

        if (probe.ok && probe.latencyMs !== null && probe.latencyMs > threshold) {
          probe = {
            ...probe,
            ok: false,
            error: `RPC latency above ${threshold}ms`,
          };
        }
      }
    } catch (error) {
      probe = {
        ...EMPTY_PROBE,
        error:
          error instanceof Error && error.name === "AbortError"
            ? `No response within ${timeoutMs}ms`
            : error instanceof Error
              ? error.message
              : "RPC health request failed",
      };
    } finally {
      clearTimeout(timer);
      inFlightRef.current = false;
    }

    if (!mountedRef.current) return;

    const history = [...historyRef.current, probe].slice(-RPC_HEALTH_HISTORY_SIZE);
    historyRef.current = history;
    consecutiveFailuresRef.current = probe.ok
      ? 0
      : consecutiveFailuresRef.current + 1;

    const failures = history.filter((sample) => !sample.ok).length;

    setSnapshot({
      status: probe.ok ? "healthy" : "degraded",
      latencyMs: probe.latencyMs,
      averageLatencyMs: averageLatency(history),
      errorRate: history.length === 0 ? 0 : failures / history.length,
      consecutiveFailures: consecutiveFailuresRef.current,
      activeEndpoint: probe.activeEndpoint,
      primaryEndpoint: probe.primaryEndpoint,
      activeProviderName: probe.activeProviderName,
      usingFallback: probe.usingFallback,
      lastCheckedAt: Date.now(),
      error: probe.error,
      isLoading: false,
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      await runProbe();
      if (!cancelled) {
        timer = setTimeout(tick, Math.max(1000, pollIntervalMs));
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollIntervalMs, runProbe]);

  return { ...snapshot, refresh: runProbe };
}
