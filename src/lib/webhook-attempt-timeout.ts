/**
 * Bounded per-attempt timeout for outgoing webhook deliveries.
 *
 * Before this module, `webhook-deliver` relied on the platform default fetch
 * timeout (or none at all), so a hanging receiver could occupy an attempt
 * indefinitely and a timeout was indistinguishable from an HTTP or network
 * failure. This module gives every attempt an explicit, bounded budget and
 * classifies a timeout as a *distinct* failure reason so it can be surfaced in
 * metrics and dead-letter records (see `webhook-dlq.ts`).
 */

/** Failure reasons recorded on a delivery attempt / dead-letter entry. */
export type DeliveryFailureReason =
  | "timeout"
  | "http_error"
  | "network_error"
  | "retry_exhausted";

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 5_000;
export const MIN_ATTEMPT_TIMEOUT_MS = 100;
export const MAX_ATTEMPT_TIMEOUT_MS = 60_000;

/** Thrown when a single delivery attempt exceeds its bounded budget. */
export class AttemptTimeoutError extends Error {
  readonly reason: DeliveryFailureReason = "timeout";

  constructor(readonly timeoutMs: number) {
    super(`Webhook attempt timed out after ${timeoutMs}ms`);
    this.name = "AttemptTimeoutError";
  }
}

/**
 * Normalise a user/config supplied timeout into a safe bounded budget.
 * Invalid, non-positive or non-finite values fall back to `fallback`.
 */
export function resolveAttemptTimeoutMs(
  raw: unknown,
  fallback: number = DEFAULT_ATTEMPT_TIMEOUT_MS,
): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_ATTEMPT_TIMEOUT_MS, Math.max(MIN_ATTEMPT_TIMEOUT_MS, Math.floor(value)));
}

/** True when `err` represents a bounded-attempt timeout (or an aborted signal). */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof AttemptTimeoutError) return true;
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return true;
    const code = (err as { code?: unknown }).code;
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return true;
  }
  return false;
}

/**
 * Classify a failed attempt into exactly one failure reason. Timeouts win over
 * status codes so a receiver that hangs is reported as `timeout`, not as the
 * generic exhausted-retries case.
 */
export function classifyFailure(err: unknown, statusCode?: number): DeliveryFailureReason {
  if (isTimeoutError(err)) return "timeout";
  if (typeof statusCode === "number") return "http_error";
  return "network_error";
}

/**
 * Run `fn` with an AbortSignal that is aborted when `timeoutMs` elapses, and
 * reject with an `AttemptTimeoutError` in that case. The timer is always
 * cleared so a fast success does not leave the process alive.
 */
export async function withAttemptTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const budget = resolveAttemptTimeoutMs(timeoutMs);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AttemptTimeoutError(budget));
    }, budget);
    // Do not hold the event loop open solely for a delivery budget.
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
