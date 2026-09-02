// SPDX-License-Identifier: MIT

import { recordEndpointLatency } from "@/lib/metrics-counters";

/**
 * Route-handler middleware that records per-endpoint latency histograms and
 * error counts keyed by (method, endpoint, status class).
 *
 * Wrap an exported route handler to opt it into metrics collection:
 *
 *   export const GET = withMetrics("GET /api/payments", async function GET(request) {
 *     ...
 *   });
 *
 * The wrapper measures wall-clock duration, reads the HTTP status from the
 * returned Response, classifies it (2xx/3xx = success, 4xx/5xx = error) and
 * forwards the response unchanged. Thrown errors are recorded as 5xx and
 * re-thrown so existing error handling still applies.
 */
export function withMetrics<H extends (...args: never[]) => unknown>(
  label: string,
  handler: H
): H {
  const spaceIdx = label.indexOf(" ");
  const method = (spaceIdx === -1 ? label : label.slice(0, spaceIdx)).toUpperCase();
  const endpoint = spaceIdx === -1 ? "" : label.slice(spaceIdx + 1);

  const wrapped = async (...args: Parameters<H>): Promise<Awaited<ReturnType<H>>> => {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let status = 0;

    try {
      const result = (await handler(...args)) as
        | { status?: number }
        | null
        | undefined;
      if (result && typeof result.status === "number") status = result.status;
      return result as Awaited<ReturnType<H>>;
    } catch (err) {
      status = 500;
      throw err;
    } finally {
      const end =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      recordEndpointLatency(method, endpoint, status, (end - start) / 1000);
    }
  };

  return wrapped as H;
}
