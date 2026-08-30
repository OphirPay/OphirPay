// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Async context carrying the current request's id.
 *
 * Kept in a leaf module (no project imports) so the logger can read the
 * current request id without forming an import cycle with
 * `request-logging.ts`, which itself imports the logger.
 *
 * The proxy (`src/proxy.ts`) mints the id and threads it into the downstream
 * request headers; `withRequestLogging` (`src/lib/request-logging.ts`) sets
 * this context for the duration of the route handler so any deep call site
 * (the logger, error handlers, background webhook delivery) can attach the
 * id to log lines without threading it through every function signature.
 */
export const requestIdContext = new AsyncLocalStorage<string>();

/** Read the current request's id (undefined outside a handled request). */
export function getCurrentRequestId(): string | undefined {
  return requestIdContext.getStore();
}
