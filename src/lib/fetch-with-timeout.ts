// SPDX-License-Identifier: MIT

/**
 * fetch() wrapper that enforces a hard wall-clock timeout per webhook attempt.
 *
 * Without this a hung endpoint can hold a delivery worker open indefinitely,
 * which is how deliveries silently disappear instead of landing in the
 * dead-letter queue. Timeouts surface as a normal Error so the existing retry
 * accounting in webhook-deliver keeps working unchanged.
 */

export class DeliveryTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Webhook delivery timed out after ${timeoutMs}ms`);
    this.name = 'DeliveryTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = init.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new DeliveryTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
