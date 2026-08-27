// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/lib/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Async context carrying the current request's id. The proxy (`src/proxy.ts`)
 * mints the id and returns it in the `X-Request-Id` response header; route
 * handlers read the same value back off the incoming request headers, so any
 * deep call site (e.g. `handleApiError`) can attach it to error logs without
 * threading it through every function signature.
 */
export const requestIdContext = new AsyncLocalStorage<string>();

/** Read the current request's id (undefined outside a handled request). */
export function getCurrentRequestId(): string | undefined {
  return requestIdContext.getStore();
}

/**
 * Loose constraint accepted by every App Router handler shape — zero, one, or
 * two parameters (dynamic routes destructure `{ params }` from the second).
 * A `never` rest type makes each parameter position trivially assignable.
 */
type RouteHandler = (...args: never[]) => Response | Promise<Response>;

/** Internal call signature used to invoke the wrapped handler. */
type HandlerCallable = (
  request: Request,
  context?: unknown
) => Response | Promise<Response>;

/**
 * Wrap an App Router route handler with structured request logging.
 *
 * Every handled API request emits a single structured log line containing the
 * request id, HTTP method, path, response status, and duration in ms — the
 * same request id that is returned in the `X-Request-Id` response header (and
 * that the proxy threaded into the downstream request headers). Unhandled
 * errors are logged with the request id and re-thrown so Next.js still
 * produces the default 500.
 *
 * The proxy cannot observe the final status or duration of a route handler
 * (it only sees the request and the pass-through response), which is why this
 * wrapper lives at the route-handler boundary rather than in `proxy.ts`.
 */
export function withRequestLogging<T extends RouteHandler>(
  handler: T
): T & HandlerCallable {
  const wrapped = async (
    request: Request,
    context?: unknown
  ): Promise<Response> => {
    const startedAt = performance.now();
    const requestId =
      request.headers.get(REQUEST_ID_HEADER) ?? (await getRequestId());

    try {
      // Concrete handler types are narrower than the internal call signature
      // (e.g. `(request, { params }) => ...`), so invoke through the callable.
      const callable = handler as unknown as HandlerCallable;
      const response = await requestIdContext.run(requestId, () =>
        callable(request, context)
      );
      const durationMs = performance.now() - startedAt;
      logger.request(
        request.method,
        new URL(request.url).pathname,
        response.status,
        durationMs,
        requestId
      );
      // Ensure the response carries the same id we logged with (idempotent
      // when the proxy already set it on the pass-through response).
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      logger.error("Unhandled API route error", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: 500,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  };

  return wrapped as unknown as T & HandlerCallable;
}
