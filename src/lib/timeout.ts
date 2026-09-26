// SPDX-License-Identifier: MIT

/**
 * Promise and HTTP timeout utilities for outbound API calls and async operations.
 * Provides explicit timeout budgets, AbortSignal integration, and classified TimeoutErrors.
 */

// ── Configurable Timeout Budgets ──────────────────────────────
// Can be tuned per environment (e.g. serverless vs edge vs local).

export const DEFAULT_TIMEOUT_MS = process.env.DEFAULT_TIMEOUT_MS
  ? parseInt(process.env.DEFAULT_TIMEOUT_MS, 10)
  : 10_000;

export const STELLAR_TIMEOUT_MS = process.env.STELLAR_TIMEOUT_MS
  ? parseInt(process.env.STELLAR_TIMEOUT_MS, 10)
  : 10_000;

export const PRICE_TIMEOUT_MS = process.env.PRICE_TIMEOUT_MS
  ? parseInt(process.env.PRICE_TIMEOUT_MS, 10)
  : 5_000;

export const WEBHOOK_TIMEOUT_MS = process.env.WEBHOOK_TIMEOUT_MS
  ? parseInt(process.env.WEBHOOK_TIMEOUT_MS, 10)
  : 5_000;

export const RPC_PROBE_TIMEOUT_MS = process.env.RPC_PROBE_TIMEOUT_MS
  ? parseInt(process.env.RPC_PROBE_TIMEOUT_MS, 10)
  : 3_000;

// ── Classified Timeout Error ──────────────────────────────────

export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  readonly timeoutMs: number;

  constructor(message = "Operation timed out", timeoutMs = 0) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/** Check if an error was caused by a timeout or aborted request. */
export function isTimeoutError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TimeoutError) return true;
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === "TimeoutError" || e.name === "AbortError" || e.code === "TIMEOUT") {
    return true;
  }
  if (typeof e.message === "string") {
    return /timed?\s*out|operation was aborted|aborted/i.test(e.message);
  }
  return false;
}

/** Combine multiple AbortSignals into a single signal that aborts when any aborts. */
export function combineSignals(signals: (AbortSignal | undefined | null)[]): AbortSignal {
  const validSignals = signals.filter((s): s is AbortSignal => Boolean(s));
  if (validSignals.length === 0) {
    return new AbortController().signal;
  }
  if (validSignals.length === 1) {
    return validSignals[0];
  }
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(validSignals);
  }
  const controller = new AbortController();
  for (const signal of validSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Wrap a promise or async action with a timeout.
 * Rejects with a classified TimeoutError if the operation does not resolve within `ms` ms.
 * Cleans up the timer on completion.
 */
export function withTimeout<T>(
  target: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  ms = DEFAULT_TIMEOUT_MS,
  message = "Operation timed out"
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(message, ms));
    }, ms);
  });

  const operationPromise = typeof target === "function" ? target(controller.signal) : target;

  return Promise.race([operationPromise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Outbound fetch wrapper with explicit timeout and AbortSignal integration.
 * Throws a classified TimeoutError if the upstream does not respond within timeoutMs.
 */
export async function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  timeoutMessage?: string
): Promise<Response> {
  const controller = new AbortController();
  const signal = init?.signal
    ? combineSignals([init.signal, controller.signal])
    : controller.signal;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMsg =
    timeoutMessage ||
    `Request to ${typeof url === "string" ? url : "upstream"} timed out after ${timeoutMs}ms`;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeoutMsg, timeoutMs));
      }, timeoutMs);
    });

    return await Promise.race([
      fetch(url, { ...init, signal }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new TimeoutError(timeoutMsg, timeoutMs);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
