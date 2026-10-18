// SPDX-License-Identifier: MIT

import { randomUUID } from "crypto";
import { headers } from "next/headers";

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Validate whether a string is a valid non-empty request/correlation ID.
 */
export function isValidRequestId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.length <= 128;
}

/**
 * Extract an existing request ID from headers or generate a fresh UUID.
 */
export function extractOrGenerateRequestId(
  inputHeaders?: Headers | Record<string, string | null | undefined> | null
): string {
  if (inputHeaders) {
    if (inputHeaders instanceof Headers) {
      const existing =
        inputHeaders.get(REQUEST_ID_HEADER) ||
        inputHeaders.get("x-request-id") ||
        inputHeaders.get("x-correlation-id");
      if (isValidRequestId(existing)) return existing.trim();
    } else if (typeof inputHeaders === "object") {
      const existing =
        inputHeaders[REQUEST_ID_HEADER] ||
        inputHeaders["x-request-id"] ||
        inputHeaders["X-Request-ID"] ||
        inputHeaders["x-correlation-id"];
      if (isValidRequestId(existing)) return existing.trim();
    }
  }
  return randomUUID();
}

/**
 * Get or create a request ID for the current request.
 * Uses the incoming X-Request-Id header if present, otherwise generates a new UUID.
 */
export async function getRequestId(): Promise<string> {
  try {
    const h = await headers();
    const existing = h.get(REQUEST_ID_HEADER) || h.get("x-request-id");
    if (isValidRequestId(existing)) return existing.trim();
  } catch {
    // headers() not available (e.g., during build or outside request scope), generate new
  }
  return randomUUID();
}

/**
 * Add request ID header to API responses for tracing.
 */
export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export { REQUEST_ID_HEADER };
