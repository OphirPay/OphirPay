// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/lib/logger";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { attachRequestIdToActiveSpan } from "@/lib/tracing";

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
type HandlerCallable = (request: Request, context?: unknown) => Response | Promise<Response>;

/**
 * Extract the pathname for logging without ever throwing. Handlers can be
 * invoked with absolute URLs (production), relative URLs (tests, mocks), or
 * — at the boundary — a malformed string; `new URL` alone would turn the
 * last case into an unhandled exception inside the logging wrapper itself,
 * masking the handler's real outcome. Parsing against a fallback base
 * accepts relative URLs, and anything still unparseable degrades to "/".
 */
function safePathname(url: string | undefined): string {
  if (!url) return "/";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

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
export function withRequestLogging<T extends RouteHandler>(handler: T): T & HandlerCallable {
  const wrapped = async (request?: Request, context?: unknown): Promise<Response> => {
    const req = request ?? new Request("http://localhost");
    const startedAt = performance.now();
    const requestId = req.headers?.get(REQUEST_ID_HEADER) ?? (await getRequestId());

    try {
      // Attach the request id to the active OpenTelemetry span (a no-op when
      // tracing is disabled) so a single payment's trace — HTTP handler,
      // contract call, Horizon poll, database writes — joins with the logs.
      attachRequestIdToActiveSpan(requestId);
      // Concrete handler types are narrower than the internal call signature
      // (e.g. `(request, { params }) => ...`), so invoke through the callable.
      const callable = handler as unknown as HandlerCallable;
      const response = await requestIdContext.run(requestId, () => callable(req, context));
      const durationMs = performance.now() - startedAt;
      logger.request(req.method || "GET", safePathname(req.url), response.status, durationMs, requestId);
      // Ensure the response carries the same id we logged with (idempotent
      // when the proxy already set it on the pass-through response).
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      logger.error("Unhandled API route error", {
        requestId,
        method: req.method || "GET",
        path: safePathname(req.url),
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
