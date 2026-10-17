// SPDX-License-Identifier: MIT

/**
 * RFC 7807 (Problem Details for HTTP APIs) implementation.
 * Provides standardized, machine-parseable error responses with `application/problem+json`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { getCurrentRequestId } from "@/lib/request-logging";
import { captureError } from "@/lib/sentry";
import { handlePrismaError } from "@/lib/prisma-errors";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface ValidationErrorItem {
  name: string;
  reason: string;
  code?: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  invalidParams?: ValidationErrorItem[];
  invalid_params?: ValidationErrorItem[];
  timestamp: string;
  [key: string]: unknown;
}

export interface FormatProblemDetailsOptions {
  type?: string;
  title?: string;
  status?: number;
  detail: string;
  instance?: string;
  code?: string;
  invalidParams?: ValidationErrorItem[];
  headers?: Record<string, string>;
  extensions?: Record<string, unknown>;
}

export interface ProblemOptions {
  instance?: string;
  code?: string;
  type?: string;
  title?: string;
  headers?: Record<string, string>;
  extensions?: Record<string, unknown>;
}

const DEFAULT_STATUS_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function getDefaultTitle(status: number): string {
  return DEFAULT_STATUS_TITLES[status] ?? "An error occurred";
}

export function getDefaultType(codeOrTitle: string): string {
  const normalized = codeOrTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://api.ophirpay.com/errors/${normalized || "generic"}`;
}

/**
 * Maps Zod issues to RFC 7807 invalidParams array.
 */
export function mapZodIssuesToInvalidParams(error: z.ZodError): ValidationErrorItem[] {
  return error.issues.map((issue) => ({
    name: issue.path.length > 0 ? issue.path.join(".") : "_root",
    reason: issue.message,
    code: issue.code,
  }));
}

/**
 * Core formatter for RFC 7807 Problem Details.
 * Always sets `Content-Type: application/problem+json`.
 */
export function formatProblemDetails(options: FormatProblemDetailsOptions): NextResponse {
  const status = options.status ?? 400;
  const title = options.title ?? getDefaultTitle(status);
  const code = options.code ?? (status === 400 ? ERROR_CODES.BAD_REQUEST : undefined);
  const type = options.type ?? (code ? getDefaultType(code) : getDefaultType(title));

  const body: ProblemDetails = {
    type,
    title,
    status,
    detail: options.detail,
    timestamp: new Date().toISOString(),
    ...(options.instance ? { instance: options.instance } : {}),
    ...(code ? { code } : {}),
    ...(options.invalidParams && options.invalidParams.length > 0
      ? {
          invalidParams: options.invalidParams,
          // Support snake_case alias for strict RFC 9457 / ecosystem compatibility
          invalid_params: options.invalidParams,
        }
      : {}),
    ...(options.extensions ?? {}),
  };

  const responseHeaders: Record<string, string> = {
    "Content-Type": PROBLEM_CONTENT_TYPE,
    ...(options.headers ?? {}),
  };

  return NextResponse.json(body, {
    status,
    headers: responseHeaders,
  });
}

/**
 * 400 Validation Error problem details helper.
 */
export function validationProblem(
  errOrItems: z.ZodError | ValidationErrorItem[] | string,
  options?: ProblemOptions
): NextResponse {
  let invalidParams: ValidationErrorItem[] = [];
  let detail = "Request validation failed";

  if (errOrItems instanceof z.ZodError) {
    invalidParams = mapZodIssuesToInvalidParams(errOrItems);
    detail = invalidParams.map((p) => `${p.name}: ${p.reason}`).join("; ") || detail;
  } else if (Array.isArray(errOrItems)) {
    invalidParams = errOrItems;
    detail = invalidParams.map((p) => `${p.name}: ${p.reason}`).join("; ") || detail;
  } else if (typeof errOrItems === "string") {
    detail = errOrItems;
  }

  return formatProblemDetails({
    status: 400,
    title: options?.title ?? "Validation Error",
    code: options?.code ?? ERROR_CODES.VALIDATION_ERROR,
    type: options?.type ?? getDefaultType(options?.code ?? ERROR_CODES.VALIDATION_ERROR),
    detail,
    instance: options?.instance,
    invalidParams,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 400 Bad Request problem details helper.
 */
export function badRequestProblem(detail: string, options?: ProblemOptions): NextResponse {
  return formatProblemDetails({
    status: 400,
    title: options?.title ?? "Bad Request",
    code: options?.code ?? ERROR_CODES.BAD_REQUEST,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 401 Unauthorized problem details helper.
 */
export function unauthorizedProblem(
  detail = "Authentication required. Connect your wallet or provide an API key.",
  options?: ProblemOptions
): NextResponse {
  return formatProblemDetails({
    status: 401,
    title: options?.title ?? "Unauthorized",
    code: options?.code ?? ERROR_CODES.UNAUTHORIZED,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 403 Forbidden problem details helper.
 */
export function forbiddenProblem(
  detail = "Insufficient permissions or invalid CSRF token.",
  options?: ProblemOptions
): NextResponse {
  return formatProblemDetails({
    status: 403,
    title: options?.title ?? "Forbidden",
    code: options?.code ?? ERROR_CODES.INSUFFICIENT_SCOPE,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 404 Not Found problem details helper.
 */
export function notFoundProblem(resource = "Payment", options?: ProblemOptions): NextResponse {
  return formatProblemDetails({
    status: 404,
    title: options?.title ?? "Not Found",
    code: options?.code ?? ERROR_CODES.NOT_FOUND,
    type: options?.type,
    detail: `${resource} not found`,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 409 Conflict problem details helper.
 */
export function conflictProblem(detail: string, options?: ProblemOptions): NextResponse {
  return formatProblemDetails({
    status: 409,
    title: options?.title ?? "Conflict",
    code: options?.code ?? ERROR_CODES.CONFLICT,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * 429 Too Many Requests problem details helper.
 */
export function rateLimitProblem(
  detail = "Too many requests. Please try again later.",
  retryAfterSeconds?: number,
  options?: ProblemOptions
): NextResponse {
  const headers = { ...(options?.headers ?? {}) };
  if (retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(Math.max(0, Math.floor(retryAfterSeconds)));
  }

  return formatProblemDetails({
    status: 429,
    title: options?.title ?? "Too Many Requests",
    code: options?.code ?? ERROR_CODES.RATE_LIMITED,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers,
    extensions: options?.extensions,
  });
}

/**
 * 500 Internal Server Error problem details helper.
 */
export function serverProblem(
  detail = "An unexpected error occurred. Please try again later.",
  options?: ProblemOptions
): NextResponse {
  return formatProblemDetails({
    status: 500,
    title: options?.title ?? "Internal Server Error",
    code: options?.code ?? ERROR_CODES.INTERNAL_ERROR,
    type: options?.type,
    detail,
    instance: options?.instance,
    headers: options?.headers,
    extensions: options?.extensions,
  });
}

/**
 * Unified error handler returning RFC 7807 Problem Details.
 */
export function handleProblemError(err: unknown, instanceOrContext?: string): NextResponse {
  const instance = instanceOrContext?.startsWith("/") ? instanceOrContext : undefined;
  const context = instanceOrContext ?? "API error";

  logger.error(context, {
    requestId: getCurrentRequestId(),
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (process.env.NEXT_PUBLIC_SENTRY_DSN && !(err instanceof z.ZodError)) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      component: context,
    });
  }

  if (err instanceof z.ZodError) {
    return validationProblem(err, { instance });
  }

  // Prisma errors
  if (
    err instanceof Error &&
    err.constructor &&
    (err.constructor.name === "PrismaClientKnownRequestError" ||
      err.constructor.name === "PrismaClientValidationError" ||
      err.constructor.name === "PrismaClientInitializationError" ||
      err.constructor.name === "PrismaClientUnknownRequestError" ||
      err.constructor.name === "PrismaClientRustPanicError")
  ) {
    const mapped = handlePrismaError(err);
    return formatProblemDetails({
      status: mapped.status,
      title: getDefaultTitle(mapped.status),
      code: mapped.code,
      detail: mapped.message,
      instance,
    });
  }

  if (err && typeof err === "object" && "code" in err) {
    const prismaCode = (err as { code: string }).code;
    if (typeof prismaCode === "string" && prismaCode.startsWith("P")) {
      const mapped = handlePrismaError(err);
      return formatProblemDetails({
        status: mapped.status,
        title: getDefaultTitle(mapped.status),
        code: mapped.code,
        detail: mapped.message,
        instance,
      });
    }
  }

  const detail =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred."
      : err instanceof Error
        ? err.message
        : "An unexpected error occurred.";

  return serverProblem(detail, { instance });
}

/**
 * Type guard to check if an object conforms to RFC 7807 Problem Details.
 */
export function isProblemDetails(obj: unknown): obj is ProblemDetails {
  if (!obj || typeof obj !== "object") return false;
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number" &&
    typeof candidate.detail === "string"
  );
}
