// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_CODES } from "@/lib/error-codes";
import { jsonSafe } from "@/lib/api-response";

// ── RFC 7807 Problem Details ──────────────────────────────────
//
// RFC 7807 (Problem Details for HTTP APIs) standardizes the shape of
// error responses so clients can parse them programmatically. The core
// fields are:
//
//   type     — URI reference for the problem type ("about:blank" if no
//              specific URI is defined)
//   title    — short human-readable summary
//   status   — HTTP status code
//   detail   — human-readable explanation specific to this occurrence
//   instance — URI reference identifying the specific occurrence
//
// Extension members (e.g. `errors` for validation field errors) are
// allowed and commonly used.

export interface ProblemDetails {
  /** URI reference for the problem type. */
  type: string;
  /** Short human-readable summary. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** URI reference identifying the specific occurrence. */
  instance?: string;
  /** Extension members — validation field errors, etc. */
  errors?: ValidationErrorItem[];
  [key: string]: unknown;
}

export interface ValidationErrorItem {
  /** JSON Pointer or field path (e.g. "body.amount" or "/amount"). */
  field: string;
  /** Human-readable validation message. */
  message: string;
}

// ── Content-Type ──────────────────────────────────────────────

export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

// ── Helper ────────────────────────────────────────────────────

/**
 * Build an RFC 7807 problem-details response.
 *
 * Sets `Content-Type: application/problem+json` and serializes the
 * problem details object. Optional `instance` and `errors` extension
 * members are included when provided.
 */
export function problemErrorResponse(
  problem: ProblemDetails,
  status?: number
): NextResponse {
  const body: Record<string, unknown> = {
    type: problem.type,
    title: problem.title,
    status: problem.status,
  };
  if (problem.detail != null) body.detail = problem.detail;
  if (problem.instance != null) body.instance = problem.instance;
  if (problem.errors != null) body.errors = problem.errors;
  // Any other extension members
  for (const [key, value] of Object.entries(problem)) {
    if (!(key in body) && value !== undefined) {
      body[key] = value;
    }
  }

  const response = NextResponse.json(jsonSafe(body), {
    status: status ?? problem.status,
    headers: { "Content-Type": PROBLEM_JSON_CONTENT_TYPE },
  });
  return response;
}

// ── Convenience builders for common problem types ─────────────

/** RFC 7807 "about:blank" URI for generic problems. */
const ABOUT_BLANK = "about:blank";

/** Build a validation problem (400) from a ZodError. */
export function validationProblem(
  err: z.ZodError,
  instance?: string
): NextResponse {
  const errors: ValidationErrorItem[] = err.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Validation failed",
    status: 400,
    detail: "One or more fields failed validation. See `errors` for details.",
    instance,
    errors,
  });
}

/** Build a bad-request problem (400). */
export function badRequestProblem(
  detail: string,
  instance?: string
): NextResponse {
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Bad request",
    status: 400,
    detail,
    instance,
  });
}

/** Build an unauthorized problem (401). */
export function unauthorizedProblem(
  detail: string = "Authentication required",
  instance?: string
): NextResponse {
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Unauthorized",
    status: 401,
    detail,
    instance,
  });
}

/** Build a not-found problem (404). */
export function notFoundProblem(
  detail: string = "Resource not found",
  instance?: string
): NextResponse {
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Not found",
    status: 404,
    detail,
    instance,
  });
}

/** Build a conflict problem (409). */
export function conflictProblem(
  detail: string,
  instance?: string
): NextResponse {
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Conflict",
    status: 409,
    detail,
    instance,
  });
}

/** Build a server-error problem (500). */
export function serverProblem(
  detail: string = "Internal server error",
  instance?: string
): NextResponse {
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: "Internal server error",
    status: 500,
    detail,
    instance,
  });
}

// ── Migration helper for existing routes ──────────────────────
//
// The existing `api-response.ts` helpers (validationError, unauthorizedError,
// etc.) still produce the `{ success: false, error: { code, message } }` envelope.
// These helpers provide a drop-in migration path: routes can switch to RFC 7807
// one at a time by replacing their error-return calls.

/**
 * Convert a legacy `{ success: false, error: { code, message, details } }`
 * response into an RFC 7807 problem-details response.
 *
 * Useful for the transition period where some routes have been migrated
 * and others have not.
 */
export function legacyToProblemDetails(
  legacy: {
    success: false;
    error: { code: string; message: string; details?: unknown };
    timestamp?: string;
  },
  instance?: string
): NextResponse {
  // Map the legacy code to an HTTP status
  const status = codeToStatus(legacy.error.code);
  return problemErrorResponse({
    type: ABOUT_BLANK,
    title: codeToTitle(legacy.error.code),
    status,
    detail: legacy.error.message,
    instance,
    ...(legacy.error.details != null
      ? { errors: normalizeDetails(legacy.error.details) }
      : {}),
  });
}

/** Map an internal error code to an HTTP status. */
function codeToStatus(code: string): number {
  // 4xx codes
  if (code.startsWith("BAD_REQUEST") || code.startsWith("VALIDATION")) return 400;
  if (code.startsWith("UNAUTHORIZED") || code.startsWith("AUTH")) return 401;
  if (code.startsWith("FORBIDDEN") || code.startsWith("INSUFFICIENT")) return 403;
  if (code.startsWith("NOT_FOUND")) return 404;
  if (code.startsWith("CONFLICT")) return 409;
  if (code.startsWith("RATE_LIMIT")) return 429;
  // Default to 500 for anything else
  return 500;
}

/** Map an error code to a human-readable title. */
function codeToTitle(code: string): string {
  const map: Record<string, string> = {
    BAD_REQUEST: "Bad request",
    VALIDATION_ERROR: "Validation failed",
    UNAUTHORIZED: "Unauthorized",
    FORBIDDEN: "Forbidden",
    INSUFFICIENT_SCOPE: "Forbidden",
    NOT_FOUND: "Not found",
    CONFLICT: "Conflict",
    RATE_LIMITED: "Too many requests",
    INTERNAL_ERROR: "Internal server error",
  };
  return map[code] ?? "Error";
}

/** Normalize a legacy `details` field into ValidationErrorItem[]. */
function normalizeDetails(details: unknown): ValidationErrorItem[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter(
      (d): d is { path?: string | string[]; message?: string } =>
        typeof d === "object" && d !== null
    )
    .map((d) => ({
      field: Array.isArray(d.path) ? d.path.join(".") : (d.path ?? ""),
      message: d.message ?? "",
    }));
}
