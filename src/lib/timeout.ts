// SPDX-License-Identifier: MIT

/**
 * Promise timeout utilities for API calls and async operations.
 *
 * Beyond the original fire-and-forget `withTimeout`, this module now exposes:
 *
 * • `TimeoutError` — a classified error (`code: "TIMEOUT"`) every caller and
 *   the UI can recognise, instead of an anonymous string.
 * • `withAbortableTimeout` — runs an operation with an `AbortSignal` that is
 *   aborted when the timeout elapses (or when a caller-supplied signal aborts),
 *   so the outbound request is actually cancelled rather than merely ignored.
 * • `fetchWithTimeout` — the standard wrapper for every raw `fetch`.
 * • Per-route timeout budgets (`getHorizonTimeoutMs`, `getSorobanTimeoutMs`, …)
 *   read from environment variables so the budget can be tuned per deployment.
 */

/**
 * Classified timeout error.
 *
 * `code` and `name` are stable so UI classifiers (and `classifyContractError`)
 * can map a timeout to actionable copy without string matching.
 */
export class TimeoutError extends Error {
  /** Stable machine code, mirroring the shared error taxonomy. */
  readonly code = "TIMEOUT";
  /** The budget that elapsed, in milliseconds. */
  readonly timeoutMs: number;
  /** Human label of the operation that timed out (e.g. "Horizon loadAccount"). */
  readonly label: string;

  constructor(timeoutMs: number, label = "Operation") {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

/**
 * True when `err` represents a timeout — either our classified
 * `TimeoutError`, a DOM `AbortError`, or a generic error whose message names a
 * timeout (covers SDK-thrown `"timeout of Nms exceeded"`).
 */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return true;
    if (err.name === "AbortError" && /timeout|timed out/i.test(err.message)) {
      return true;
    }
    return /timed out|timeout of \d+ms|ETIMEDOUT/i.test(err.message);
  }
  return false;
}

// ── Configurable timeout budgets ───────────────────────────────

/** Default budgets (ms) used when the matching env var is unset/invalid. */
export const DEFAULT_TIMEOUTS_MS = {
  /** Umbrella Stellar budget (Horizon + Soroban) when a specific one is unset. */
  stellar: 10_000,
  horizon: 10_000,
  soroban: 10_000,
  price: 5_000,
  webhook: 5_000,
  failoverProbe: 3_000,
} as const;

/** Read a positive integer millisecond budget from the environment. */
function readTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Overall Stellar request budget (`STELLAR_REQUEST_TIMEOUT_MS`). */
export function getStellarTimeoutMs(): number {
  return readTimeoutEnv("STELLAR_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUTS_MS.stellar);
}

/** Horizon REST budget (`HORIZON_REQUEST_TIMEOUT_MS`, falls back to Stellar). */
export function getHorizonTimeoutMs(): number {
  return readTimeoutEnv("HORIZON_REQUEST_TIMEOUT_MS", getStellarTimeoutMs());
}

/** Soroban RPC budget (`SOROBAN_RPC_TIMEOUT_MS`, falls back to Stellar). */
export function getSorobanTimeoutMs(): number {
  return readTimeoutEnv("SOROBAN_RPC_TIMEOUT_MS", getStellarTimeoutMs());
}

/** Price-oracle budget (`PRICE_REQUEST_TIMEOUT_MS`). */
export function getPriceTimeoutMs(): number {
  return readTimeoutEnv("PRICE_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUTS_MS.price);
}

/** Webhook delivery budget (`WEBHOOK_TIMEOUT_MS`). */
export function getWebhookTimeoutMs(): number {
  return readTimeoutEnv("WEBHOOK_TIMEOUT_MS", DEFAULT_TIMEOUTS_MS.webhook);
}

/** RPC health-probe budget (`RPC_PROBE_TIMEOUT_MS`). */
export function getFailoverProbeTimeoutMs(): number {
  return readTimeoutEnv("RPC_PROBE_TIMEOUT_MS", DEFAULT_TIMEOUTS_MS.failoverProbe);
}

// ── Abortable timeout ──────────────────────────────────────────

/**
 * Run `operation` with an `AbortSignal` that fires when `timeoutMs` elapses.
 *
 * - On timeout the controller is aborted and a classified `TimeoutError` is
 *   thrown (the underlying request sees the abort via the supplied signal).
 * - A caller `signal` is linked, so an upstream cancel also aborts the
 *   operation; in that case the original abort error propagates.
 */
export async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; signal?: AbortSignal; label?: string }
): Promise<T> {
  const { timeoutMs, signal, label = "Operation" } = options;
  const controller = new AbortController();

  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  // Race the operation against the budget so an operation that ignores its
  // AbortSignal still rejects on time. `Promise.race` attaches handlers to
  // both promises, so a late settlement can never become an unhandled
  // rejection.
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new TimeoutError(timeoutMs, label));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } catch (err) {
    // When the operation honours its signal it rejects with the abort error
    // first; normalize that back to the classified timeout error whenever our
    // own budget caused the abort.
    if (timedOut && !(err instanceof TimeoutError)) {
      throw new TimeoutError(timeoutMs, label);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * `fetch` with an explicit timeout + `AbortSignal`. Use this for every
 * outbound HTTP call so a slow upstream becomes a classified `TimeoutError`
 * instead of a hung request that blows the serverless request budget.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; signal?: AbortSignal; label?: string } = {}
): Promise<Response> {
  const {
    timeoutMs = getStellarTimeoutMs(),
    signal,
    label = "HTTP request",
  } = options;
  return withAbortableTimeout(
    (combinedSignal) => fetch(input, { ...init, signal: combinedSignal }),
    { timeoutMs, signal, label }
  );
}

/**
 * Wrap a promise with a timeout. Rejects if the promise doesn't resolve within `ms` ms.
 *
 * Kept for the SDK call sites whose underlying HTTP client doesn't accept an
 * `AbortSignal`; use `withAbortableTimeout`/`fetchWithTimeout` for new calls.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "Operation timed out"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}

/**
 * Race a Stellar SDK promise (Horizon/Soroban) against an explicit budget,
 * surfacing a classified `TimeoutError` on expiry.
 */
export function withStellarTimeout<T>(
  promise: Promise<T>,
  options: { timeoutMs?: number; label?: string } = {}
): Promise<T> {
  return withAbortableTimeout(() => promise, {
    timeoutMs: options.timeoutMs ?? getStellarTimeoutMs(),
    label: options.label,
  });
}

/**
 * Wrap a Stellar SDK server (Horizon or Soroban RPC) so **every** method call
 * carries an explicit timeout: promise-returning methods race against the
 * budget, and fluent call builders get their `.call()` (and any chained
 * builder method) wrapped too.
 *
 * This lets `getHorizonServer()` / `getSorobanServer()` enforce a timeout on
 * all outbound calls from one place, instead of every call site remembering to
 * wrap its own promise.
 */
export function withStellarTimeoutProxy<T extends object>(
  target: T,
  timeoutMs: number,
  label: string
): T {
  const wrapResult = (result: unknown, opLabel: string): unknown => {
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      return withStellarTimeout(result as Promise<unknown>, {
        timeoutMs,
        label: opLabel,
      });
    }
    if (result !== null && typeof result === "object") {
      // Fluent call builder — proxy so every chained method (including
      // `.call()`) is wrapped as well.
      return new Proxy(result, {
        get(o, prop, receiver) {
          const value = Reflect.get(o, prop, receiver);
          if (typeof value === "function") {
            return (...args: unknown[]) =>
              wrapResult(
                (value as (...a: unknown[]) => unknown).apply(o, args),
                `${opLabel}.${String(prop)}`
              );
          }
          return value;
        },
      });
    }
    return result;
  };

  return new Proxy(target, {
    get(o, prop, receiver) {
      const value = Reflect.get(o, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) =>
          wrapResult(
            (value as (...a: unknown[]) => unknown).apply(o, args),
            `${label}.${String(prop)}`
          );
      }
      return value;
    },
  });
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Debounce a function — only execute after `ms` ms of inactivity.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Throttle a function — execute at most once every `ms` ms.
 */
export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let last = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}
