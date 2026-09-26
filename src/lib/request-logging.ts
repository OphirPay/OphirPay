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
type HandlerCallable = (request: Request, context?: unknown) => Response | Promise<Response>;

import {
  withSpan,
  SpanKind,
  SpanStatusCode,
  getCurrentTraceId,
  registerRequestIdGetter,
} from "@/lib/tracing";

registerRequestIdGetter(getCurrentRequestId);

/**
 * Wrap an App Router route handler with structured request logging and OpenTelemetry tracing.
 *
 * Every handled API request emits a single structured log line containing the
 * request id, HTTP method, path, response status, and duration in ms — the
 * same request id that is returned in the `X-Request-Id` response header (and
 * that the proxy threaded into the downstream request headers).
 *
 * When tracing is enabled, this creates a root HTTP server span with `request.id`
 * correlated, and all downstream Soroban contract calls, Horizon polls, and
 * Prisma writes run as child spans within this trace.
 */
export function withRequestLogging<T extends RouteHandler>(handler: T): T & HandlerCallable {
  const wrapped = async (request?: Request, context?: unknown): Promise<Response> => {
    const req = request ?? new Request("http://localhost");
    const startedAt = performance.now();
    const requestId = req.headers?.get(REQUEST_ID_HEADER) ?? (await getRequestId());
    const pathname = new URL(req.url).pathname;

    return withSpan(
      `HTTP ${req.method} ${pathname}`,
      async (span) => {
        span.setAttributes({
          "request.id": requestId,
          "http.method": req.method,
          "http.target": pathname,
          "http.route": pathname,
        });

        try {
          // Concrete handler types are narrower than the internal call signature
          // (e.g. `(request, { params }) => ...`), so invoke through the callable.
          const callable = handler as unknown as HandlerCallable;
          const response = await requestIdContext.run(requestId, () => callable(req, context));
          const durationMs = performance.now() - startedAt;

          span.setAttribute("http.status_code", response.status);
          if (response.status >= 500) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${response.status}`,
            });
          }

          logger.request(req.method, pathname, response.status, durationMs, requestId);

          // Ensure the response carries the same id we logged with (idempotent
          // when the proxy already set it on the pass-through response).
          response.headers.set(REQUEST_ID_HEADER, requestId);
          const traceId = getCurrentTraceId();
          if (traceId) {
            response.headers.set("X-Trace-Id", traceId);
          }

          return response;
        } catch (err) {
          const durationMs = performance.now() - startedAt;
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          span.setAttribute("http.status_code", 500);

          logger.error("Unhandled API route error", {
            requestId,
            method: req.method,
            path: pathname,
            status: 500,
            durationMs,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
          throw err;
        }
      },
      { kind: SpanKind.SERVER }
    );
  };

  return wrapped as unknown as T & HandlerCallable;
}

