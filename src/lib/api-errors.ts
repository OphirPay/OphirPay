// SPDX-License-Identifier: MIT

/**
 * RFC 7807 problem details for the /api/payments routes (Issue #1364).
 *
 * Error responses on payment mutation routes are formatted as
 * `application/problem+json` per RFC 7807. Zod validation field errors are
 * carried in the `errors` extension member.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";

export interface ProblemDetails {
  /** A URI reference identifying the problem type. */
  type: string;
  /** A short, human-readable summary of the problem type. */
  title: string;
  /** The HTTP status code. */
  status: number;
  /** A human-readable explanation specific to this occurrence. */
  detail?: string;
  /** The request URI that caused the problem. */
  instance?: string;
}

/** Validation field errors (`errors` extension member of RFC 7807). */
export interface ProblemFieldError {
  path: string;
  message: string;
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/** Fallback title for statuses without a specific mapping. */
export function titleForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 429:
      return "Too Many Requests";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Failed";
  }
}

/** URI slug for a known error code, used as the problem `type` suffix. */
export function typeSlugForCode(code: string): string {
  const slug = code
    .toLowerCase()
    .replace(/_/g, "-");
  return slug || "error";
}

/**
 * Build an RFC 7807 problem details object. Only `type`, `title`, `status`,
 * and `detail`/`instance` members are emitted; extension members (`errors`)
 * are attached by the callers below.
 */
export function formatProblemDetails({
  type,
  title,
  status,
  detail,
  instance,
}: {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}): ProblemDetails {
  const problem: ProblemDetails = { type, title, status };
  if (detail !== undefined) problem.detail = detail;
  if (instance !== undefined) problem.instance = instance;
  return problem;
}

/**
 * Return a NextResponse carrying `application/problem+json`.
 * `errors` is the RFC 7807 extension member carrying validation field errors.
 */
export function problemResponse(
  problem: ProblemDetails,
  errors?: ProblemFieldError[],
  extraHeaders?: Record<string, string>
): NextResponse {
  const body: Record<string, unknown> = { ...problem };
  if (errors && errors.length > 0) body.errors = errors;
  return NextResponse.json(body, {
    status: problem.status,
    headers: {
      "Content-Type": PROBLEM_CONTENT_TYPE,
      ...(extraHeaders ?? {}),
    },
  });
}

/** RFC 7807 validation failure (400) with per-field errors. */
export function validationProblem(
  err: z.ZodError,
  instance: string
): NextResponse {
  const problem = formatProblemDetails({
    type: `https://ophirpay.dev/problems/${typeSlugForCode(
      ERROR_CODES.VALIDATION_ERROR
    )}`,
    title: titleForStatus(400),
    status: 400,
    detail: "Request validation failed",
    instance,
  });
  const errors: ProblemFieldError[] = err.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return problemResponse(problem, errors);
}

/**
 * Convert a legacy (non-problem) Response — e.g. the CSRF rejection — into an
 * RFC 7807 problem+json response, preserving status/code/message.
 */
export async function problemFromResponse(
  response: Response,
  instance: string
): Promise<NextResponse> {
  const status = response.status;
  let code = "CSRF_INVALID";
  let message = "Invalid or missing CSRF token. Refresh the page and try again.";
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Keep defaults if the body cannot be read.
  }
  return codeProblem(code, message, status, instance);
}

/** RFC 7807 response for a simple (code + message) error. */
export function codeProblem(
  code: string,
  message: string,
  status: number,
  instance: string
): NextResponse {
  return problemResponse(
    formatProblemDetails({
      type: `https://ophirpay.dev/problems/${typeSlugForCode(code)}`,
      title: titleForStatus(status),
      status,
      detail: message,
      instance,
    })
  );
}

/**
 * Map a caught error to a problem+json response. Delegates the status/code
 * mapping (Prisma, Zod, generic) to the shared handleApiError, then reformats
 * the resulting error payload as RFC 7807.
 */
export async function handleApiErrorProblem(
  err: unknown,
  context: string,
  instance: string
): Promise<NextResponse> {
  const fallback = handleApiError(err, context);
  // handleApiError only ever returns non-2xx JSON error payloads; read the
  // body to recover the mapped code/message, then reformat as RFC 7807.
  let status = 500;
  let code: string = ERROR_CODES.INTERNAL_ERROR;
  let message = "An unexpected error occurred.";
  try {
    status = fallback.status;
    const body = (await fallback.json()) as {
      error?: { code?: string; message?: string };
    };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Keep defaults if the body cannot be read.
  }
  return codeProblem(code, message, status, instance);
}
