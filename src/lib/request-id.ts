// SPDX-License-Identifier: MIT

import { randomUUID } from "crypto";
import { headers } from "next/headers";

const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Extract a non-empty request ID from a Request's X-Request-Id header.
 */
export function extractRequestId(
  request?: Pick<Request, "headers"> | null
): string | undefined {
  const value = request?.headers?.get(REQUEST_ID_HEADER)?.trim();
  return value || undefined;
}

/**
 * Get or create a request ID for the current request.
 * Uses the incoming X-Request-Id header if present, otherwise generates a new UUID.
 */
export async function getRequestId(
  request?: Pick<Request, "headers"> | null
): Promise<string> {
  const fromRequest = extractRequestId(request);
  if (fromRequest) return fromRequest;

  try {
    const h = await headers();
    const existing = h.get(REQUEST_ID_HEADER)?.trim();
    if (existing) return existing;
  } catch {
    // headers() not available (e.g., during build), generate new
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
