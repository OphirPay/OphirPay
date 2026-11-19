// SPDX-License-Identifier: MIT

/**
 * RFC 7807 "Problem Details for HTTP APIs" — the wire contract (issue #1364).
 *
 * This module is deliberately free of server-only imports (`next/server`, the
 * logger, Prisma). The browser fetchers (`src/lib/api-client.ts`,
 * `src/hooks/useApiQuery.ts`) and the published SDK
 * (`packages/ophirpay-client`) all have to understand the exact same shape, so
 * the type, the media type and the "turn this into `{ code, message }`"
 * normalizer live here once instead of being re-derived in each client.
 *
 * The server half — building a `Response` from these fields — lives in
 * `src/lib/api-errors.ts`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */

/** Registered media type for a problem-details body. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * Base URI for this API's problem `type` values.
 *
 * `type` is a URI reference that identifies the *kind* of problem so a client
 * can branch on it without string-matching prose. It is intentionally a
 * documentation URI (never fetched automatically by clients).
 */
export const PROBLEM_TYPE_BASE = "https://ophirpay.dev/problems";

/**
 * RFC 9457 registers `about:blank` as the value used when a response carries
 * no more specific problem type. We only fall back to it when the caller has
 * neither a code nor a title to derive a URI from.
 */
export const PROBLEM_TYPE_BLANK = "about:blank";

/** One invalid request field, keyed by its dotted path (`memo`, `recipients.0.address`). */
export interface ProblemFieldError {
  /** Dotted path of the offending field. `(body)` when the whole body fails. */
  field: string;
  /** User-facing, safe-to-display explanation. */
  message: string;
  /** Stable machine-readable reason (e.g. a Zod issue code), when known. */
  code?: string;
}

/**
 * A problem-details document.
 *
 * `type` / `title` / `status` are the RFC members; `code`, `requestId` and
 * `errors` are the standard extension members this API adds. Extensions are
 * allowed by the RFC and ignored by clients that do not know them.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Path (and query, when relevant) of the request that failed. */
  instance?: string;
  /** OphirPay error code from `src/lib/error-codes.ts`, e.g. `MEMO_TOO_LONG`. */
  code?: string;
  /** Correlates this body with the `X-Request-Id` response header and logs. */
  requestId?: string;
  errors?: ProblemFieldError[];
  [extension: string]: unknown;
}

/**
 * Structural check for a problem-details body.
 *
 * The three required members are what make a body *a problem*: a legacy
 * `{ success: false, error: { … } }` envelope has none of them, so a client can
 * tell the two apart (and support both while the rest of the API migrates).
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}

/** The narrow error shape every client in this repo surfaces. */
export interface NormalizedApiError {
  /** Machine-readable code — the problem `code` extension when present. */
  code: string;
  /** Human-readable message, safe to show in a UI/toast. */
  message: string;
  /** Per-field validation errors, when the server supplied them. */
  fields?: ProblemFieldError[];
}

/**
 * Normalize *either* wire format into `{ code, message, fields }`.
 *
 * Payments mutations now answer with problem details, but the rest of the API
 * still uses the `{ success: false, error: { code, message } }` envelope
 * (`src/lib/api-response.ts`). Clients must tolerate both while the migration
 * is in progress, and must keep the code stable so branch-y logic (CSRF retry,
 * `OPERATION_IN_PROGRESS` polling) keeps working across the change.
 */
export function normalizeApiError(
  payload: unknown,
  status: number
): NormalizedApiError {
  if (isProblemDetails(payload)) {
    return {
      code:
        typeof payload.code === "string" && payload.code.length > 0
          ? payload.code
          : `HTTP_${status}`,
      message:
        (typeof payload.detail === "string" && payload.detail.length > 0
          ? payload.detail
          : payload.title) || `Request failed with status ${status}`,
      ...(Array.isArray(payload.errors) && payload.errors.length > 0
        ? { fields: payload.errors }
        : {}),
    };
  }

  if (payload && typeof payload === "object") {
    const envelope = (
      payload as { error?: { code?: unknown; message?: unknown } }
    ).error;
    if (envelope && typeof envelope === "object") {
      return {
        code:
          typeof envelope.code === "string" && envelope.code.length > 0
            ? envelope.code
            : `HTTP_${status}`,
        message:
          typeof envelope.message === "string" && envelope.message.length > 0
            ? envelope.message
            : `Request failed with status ${status}`,
      };
    }
  }

  return {
    code: `HTTP_${status}`,
    message: `Request failed with status ${status}`,
  };
}
