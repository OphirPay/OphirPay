// SPDX-License-Identifier: MIT

import { randomUUID } from "crypto";
import { headers } from "next/headers";

const REQUEST_ID_HEADER = "X-Request-Id";
const TRACEPARENT_HEADER = "traceparent";
const TRACE_ID_HEADER = "X-Trace-Id";

/**
 * Get or create a request ID for the current request.
 * Uses the incoming X-Request-Id header if present, otherwise generates a new UUID.
 */
export async function getRequestId(): Promise<string> {
  try {
    const h = await headers();
    const existing = h.get(REQUEST_ID_HEADER);
    if (existing) return existing;
  } catch {
    // headers() not available (e.g., during build), generate new
  }
  return randomUUID();
}

/**
 * Add request ID header to API responses for tracing and correlation.
 */
export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Add distributed trace correlation headers to API responses when tracing is active.
 */
export function withTraceHeaders(
  response: Response,
  requestId?: string,
  traceId?: string
): Response {
  if (requestId) {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  }
  if (traceId) {
    response.headers.set(TRACE_ID_HEADER, traceId);
  }
  return response;
}

export { REQUEST_ID_HEADER, TRACEPARENT_HEADER, TRACE_ID_HEADER };

