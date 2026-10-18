// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Async context carrying the current request's correlation ID.
 */
export const requestIdContext = new AsyncLocalStorage<string>();

/**
 * Read the current request's correlation ID (undefined outside a handled request).
 */
export function getCurrentRequestId(): string | undefined {
  return requestIdContext.getStore();
}
