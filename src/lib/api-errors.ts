// SPDX-License-Identifier: MIT

/**
 * RFC 7807 Problem Details for HTTP APIs.
 *
 * Standardizes error responses across all /api/payments routes so that
 * client SDKs can parse errors consistently. Instead of varying JSON
 * structures (`{ error: "msg" }`, `{ message: "..." }`, `{ code, details }`),
 * every error now follows the RFC 7807 `application/problem+json` format.
 *
 * @see https://www.rfc-editor.org/rfc/rfc7807
 */

import { z } from "zod";
import { getCurrentRequestId } from "@/lib/request-logging";

/** RFC 7807 Problem Details object. */
export interface ProblemDetails {
  /** URI reference identifying the problem type. */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** URI reference identifying this specific occurrence. */
  instance?: string;
  /** Additional members — e.g. field-level validation errors. */
  [key: string]: unknown;
}

/** Base URI for OphirPay problem types. */
const PROBLEM_TYPE_BASE = "https://docs.ophirpay.com/errors";

/**
 * Map HTTP status codes to RFC 7807 problem type URIs and titles.
 */
const STATUS_PROBLEMS: Record<number, { type: string; title: string }> = {
  400: { type: "bad-request", title: "Bad Request" },
  401: { type: "unauthorized", title: "Unauthorized" },
  403: { type: "forbidden", title: "Forbidden" },
  404: { type: "not-found", title: "Not Found" },
  409: { type: "conflict", title: "Conflict" },
  422: { type: "validation-error", title: "Validation Error" },
  429: { type: "rate-limited", title: "Too Many Requests" },
  500: { type: "internal-error", title: "Internal Server Error" },
  502: { type: "bad-gateway", title: "Bad Gateway" },
  503: { type: "service-unavailable", title: "Service Unavailable" },
};

/**
 * Build an RFC 7807 problem details object.
 *
 * @param status HTTP status code
 * @param detail Human-readable explanation
 * @param extra Additional fields (e.g. `errors` for validation failures)
 */
export function formatProblemDetails(
  status: number,
  detail?: string,
  extra?: Record<string, unknown>
): ProblemDetails {
  const problem = STATUS_PROBLEMS[status] ?? {
    type: "unknown",
    title: "Unknown Error",
  };

  const requestId = getCurrentRequestId();

  const result: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}/${problem.type}`,
    title: problem.title,
    status,
    ...(detail ? { detail } : {}),
    ...(requestId ? { instance: `urn:request:${requestId}` } : {}),
    ...extra,
  };

  return result;
}

/**
 * Build a Next.js Response with `application/problem+json` content type.
 *
 * Use this helper in route handlers instead of the legacy `errorResponse()`
 * for all /api/payments routes.
 */
export function problemJsonResponse(
  problem: ProblemDetails,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "Content-Type": "application/problem+json",
      ...headers,
    },
  });
}

/**
 * Convenience: format + respond in one call.
 */
export function problemResponse(
  status: number,
  detail?: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>
): Response {
  return problemJsonResponse(formatProblemDetails(status, detail, extra), headers);
}

/**
 * Map Zod validation errors to RFC 7807 field errors.
 *
 * Returns the `errors` array suitable for the `errors` member of a
 * 422 problem details object.
 */
export function zodFieldErrors(err: z.ZodError): Array<{
  field: string;
  message: string;
}> {
  return err.issues.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}
