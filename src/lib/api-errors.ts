// SPDX-License-Identifier: MIT

/**
 * RFC 7807 problem-details response builder (issue #1364).
 *
 * The payment mutation routes (`POST /api/payments`, `POST /api/payments/cancel`,
 * `POST /api/payments/retry`) used to answer failures in the generic success
 * envelope, so a client had to parse `success === false`, then read
 * `error.code` / `error.message` / `error.details`, and hope the shape matched
 * the route it called. They now answer with a single, registered media type:
 *
 *   Content-Type: application/problem+json
 *   { "type", "title", "status", "detail", "instance", "code", "errors" }
 *
 * `type`/`title`/`status`/`detail`/`instance` are the RFC 9457 members; `code`
 * and `errors` are extension members that carry this API's machine-readable
 * error code and the per-field validation failures. `requestId` mirrors the
 * `X-Request-Id` header so a report can be correlated with server logs.
 *
 * Two things this module deliberately does *not* do:
 *
 *   • It does not invent a new error taxonomy. Codes still come from
 *     `src/lib/error-codes.ts` (the catalog in `docs/API_ERRORS.md`), so a
 *     client that already switches on `code` keeps working.
 *   • It does not swallow failures. `problemFromError` logs through the same
 *     path as `handleApiError` (`logApiError`), because a 500 rendered as a
 *     problem document is still a server fault that has to be observable.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { classifyApiError, logApiError } from "@/lib/api-response";
import { getCurrentRequestId } from "@/lib/request-logging";
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_BASE,
  PROBLEM_TYPE_BLANK,
  type ProblemDetails,
  type ProblemFieldError,
} from "@/lib/problem-details";

/**
 * Canonical `title` for a status code.
 *
 * RFC 9457 asks that `title` stay stable for a given `type` — it is the
 * human-readable *name* of the problem class, not a message. The
 * request-specific explanation belongs in `detail`.
 */
export function problemTitleForStatus(status: number): string {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    451: "Unavailable For Legal Reasons",
    500: "Internal Server Error",
    503: "Service Unavailable",
  };
  if (titles[status]) return titles[status];
  return status >= 500 ? "Server Error" : "Client Error";
}

/** Lower-case a code into a stable URI slug (`MEMO_TOO_LONG` → `memo-too-long`). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The `type` URI for a failure.
 *
 * Prefer the error code so the URI identifies the *condition*
 * (`…/problems/memo-too-long`), not merely the HTTP status (a 400 for a bad
 * memo and a 400 for a bad cursor are different problems to fix). When no code
 * is known, fall back to `about:blank`, which RFC 9457 defines as the value for
 * "no more specific type available".
 */
export function problemTypeFor(code: string | undefined): string {
  if (code) return `${PROBLEM_TYPE_BASE}/${slugify(code)}`;
  return PROBLEM_TYPE_BLANK;
}

/** Input accepted by {@link formatProblemDetails}. */
export interface ProblemInput {
  status: number;
  /** OphirPay error code; becomes both `type` and the `code` extension. */
  code?: string;
  /** Overrides the canonical title for the status. Use sparingly. */
  title?: string;
  /** Request-specific explanation. Defaults to `title` when omitted. */
  detail?: string;
  /** Request path (and query) that produced the problem. */
  instance?: string;
  /** Per-field validation failures. */
  errors?: ProblemFieldError[];
  /** Extra response headers (e.g. `Retry-After` on a 409/429). */
  headers?: Record<string, string>;
}

/**
 * Build a `application/problem+json` response.
 *
 * The body is serialized by hand rather than with `NextResponse.json` so the
 * `Content-Type` is exactly `application/problem+json` — a helper that sets
 * `application/json` and leaves the body problem-shaped would defeat the point
 * of a registered media type.
 */
export function formatProblemDetails(input: ProblemInput): NextResponse {
  const title = input.title ?? problemTitleForStatus(input.status);
  const body: ProblemDetails = {
    type: problemTypeFor(input.code),
    title,
    status: input.status,
    detail: input.detail ?? title,
    ...(input.instance ? { instance: input.instance } : {}),
    ...(input.code ? { code: input.code } : {}),
    ...(input.errors && input.errors.length > 0
      ? { errors: input.errors }
      : {}),
  };

  const requestId = getCurrentRequestId();
  if (requestId) body.requestId = requestId;

  return new NextResponse(JSON.stringify(body), {
    status: input.status,
    headers: {
      "Content-Type": PROBLEM_CONTENT_TYPE,
      // A failure must never be cached or replayed by an intermediary.
      "Cache-Control": "no-store",
      ...(input.headers ?? {}),
    },
  });
}

/** Map Zod issues onto the `errors` extension member. */
export function problemFieldErrors(err: z.ZodError): ProblemFieldError[] {
  return err.issues.map((issue) => ({
    // An issue with no path fails the body as a whole, not a named field.
    field: issue.path.length > 0 ? issue.path.join(".") : "(body)",
    message: issue.message,
    ...(typeof issue.code === "string" ? { code: issue.code } : {}),
  }));
}

/**
 * 400 for a failed request schema.
 *
 * `detail` stays generic on purpose: the actionable text belongs next to the
 * field it describes in `errors`, where a form can attach it to the right
 * input. The legacy helper joined every message into one string, which is
 * exactly what made field-level display impossible.
 */
export function problemFromZodError(
  err: z.ZodError,
  options: { instance?: string; detail?: string } = {}
): NextResponse {
  const errors = problemFieldErrors(err);
  return formatProblemDetails({
    status: 400,
    code: "VALIDATION_ERROR",
    title: "Request validation failed",
    detail:
      options.detail ??
      (errors.length === 1
        ? errors[0].message
        : `Request validation failed for ${errors.length} fields`),
    instance: options.instance,
    errors,
  });
}

/** 400 for a hand-written constraint that is not expressed as a Zod schema. */
export function problemBadRequest(
  detail: string,
  options: { instance?: string; code?: string } = {}
): NextResponse {
  return formatProblemDetails({
    status: 400,
    code: options.code ?? "BAD_REQUEST",
    detail,
    instance: options.instance,
  });
}

export function problemUnauthorized(
  detail = "Authentication required. Connect your wallet or provide an API key.",
  options: { instance?: string } = {}
): NextResponse {
  return formatProblemDetails({
    status: 401,
    code: "UNAUTHORIZED",
    detail,
    instance: options.instance,
  });
}

export function problemNotFound(
  resource = "Resource",
  options: { instance?: string } = {}
): NextResponse {
  return formatProblemDetails({
    status: 404,
    code: "NOT_FOUND",
    detail: `${resource} not found`,
    instance: options.instance,
  });
}

export function problemConflict(
  detail: string,
  options: { instance?: string; code?: string; headers?: Record<string, string> } = {}
): NextResponse {
  return formatProblemDetails({
    status: 409,
    code: options.code ?? "CONFLICT",
    detail,
    instance: options.instance,
    headers: options.headers,
  });
}

/**
 * Map any caught error to a problem-details response.
 *
 * Uses the same classifier as the legacy handler, so the two formats cannot
 * disagree about the status code or the production message masking — only
 * about serialization. Unexpected errors are still logged (and captured) once,
 * here, because the route's `catch` no longer calls `handleApiError`.
 */
export function problemFromError(err: unknown, instance?: string): NextResponse {
  if (err instanceof z.ZodError) {
    return problemFromZodError(err, { instance });
  }

  logApiError(err, instance ? `${instance} error` : undefined);
  const classified = classifyApiError(err);
  return formatProblemDetails({
    status: classified.status,
    code: classified.code,
    detail: classified.message,
    instance,
  });
}

/**
 * Re-render a legacy-envelope `Response` as problem details.
 *
 * Some shared middleware still answers in the old shape — most importantly
 * `verifyCsrf`, whose 403 is produced before a route's own error handling
 * runs. Returning it unchanged would leave precisely one non-conforming error
 * on the very routes this migration covers, so the body is read (from a clone)
 * and the status/code/message are carried across. Headers such as `Retry-After`
 * survive the conversion.
 */
export async function problemFromLegacyResponse(
  response: Response,
  instance?: string
): Promise<NextResponse> {
  let code: string | undefined;
  let detail: string | undefined;
  let errors: ProblemFieldError[] | undefined;

  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown; message?: unknown; details?: unknown };
    };
    const envelope = body?.error;
    if (envelope && typeof envelope === "object") {
      if (typeof envelope.code === "string") code = envelope.code;
      if (typeof envelope.message === "string" && envelope.message.length > 0) {
        detail = envelope.message;
      }
      if (Array.isArray(envelope.details)) {
        const mapped = envelope.details
          .filter(
            (item): item is { path?: unknown; message?: unknown } =>
              !!item && typeof item === "object"
          )
          .map((item) => ({
            field: typeof item.path === "string" ? item.path : "(body)",
            message: String(item.message ?? "Invalid value"),
          }));
        if (mapped.length > 0) errors = mapped;
      }
    }
  } catch {
    // Non-JSON body (or an empty one): fall back to the status semantics.
  }

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "content-type" || lower === "content-length") return;
    headers[key] = value;
  });

  return formatProblemDetails({
    status: response.status,
    code,
    detail,
    instance,
    errors,
    headers,
  });
}
