// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_CODES } from "@/lib/error-codes";
import { handlePrismaError } from "@/lib/prisma-errors";
import { logger } from "@/lib/logger";
import { getCurrentRequestId } from "@/lib/request-logging";
import { captureError } from "@/lib/sentry";
import { jsonSafe } from "@/lib/api-response";

export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";
export const PROBLEM_BASE_URI = "https://api.ophirpay.com/problems";

export interface ValidationFieldError {
  field: string;
  path: string;
  message: string;
  code?: string;
}

export interface ProblemDetailsInput {
  type?: string;
  title?: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  errors?: ValidationFieldError[];
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  errors?: ValidationFieldError[];
}

const DEFAULT_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

const DEFAULT_CODES: Record<number, string> = {
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  422: ERROR_CODES.UNPROCESSABLE_ENTITY,
  429: ERROR_CODES.RATE_LIMITED,
  500: ERROR_CODES.INTERNAL_ERROR,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

/**
 * Format an error payload according to RFC 7807 (Problem Details for HTTP APIs).
 */
export function formatProblemDetails({
  type = "about:blank",
  title,
  status,
  detail,
  instance,
  code,
  errors,
}: ProblemDetailsInput): ProblemDetails {
  const resolvedTitle = title ?? DEFAULT_TITLES[status] ?? "Error";
  return {
    type,
    title: resolvedTitle,
    status,
    detail,
    ...(instance !== undefined ? { instance } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(errors !== undefined ? { errors: jsonSafe(errors) as ValidationFieldError[] } : {}),
  };
}

/**
 * Map Zod schema issues to standardized RFC 7807 validation field errors.
 */
export function mapZodErrors(err: z.ZodError): ValidationFieldError[] {
  return err.issues.map((issue) => {
    const joinedPath = issue.path.join(".");
    return {
      field: joinedPath || "root",
      path: joinedPath,
      message: issue.message,
      code: issue.code,
    };
  });
}

/**
 * Create a NextResponse with `Content-Type: application/problem+json` and RFC 7807
 * problem details, plus backward-compatible envelope extensions (`success: false`, `error`).
 */
export function problemResponse(
  input: ProblemDetailsInput,
  extraHeaders?: Record<string, string>
): NextResponse {
  const problem = formatProblemDetails(input);
  const resolvedCode =
    input.code ?? DEFAULT_CODES[problem.status] ?? ERROR_CODES.INTERNAL_ERROR;

  const body = {
    ...problem,
    success: false as const,
    error: {
      code: resolvedCode,
      message: problem.detail,
      ...(problem.errors !== undefined ? { details: problem.errors } : {}),
    },
    timestamp: new Date().toISOString(),
  };

  const response = NextResponse.json(body, {
    status: problem.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
      ...(extraHeaders ?? {}),
    },
  });
  response.headers.set("Content-Type", PROBLEM_JSON_CONTENT_TYPE);
  return response;
}

export function validationProblem(
  err: z.ZodError,
  instance?: string,
  detail = "Request validation failed"
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/validation-error`,
    title: "Validation Error",
    status: 400,
    detail,
    instance,
    code: ERROR_CODES.VALIDATION_ERROR,
    errors: mapZodErrors(err),
  });
}

export function badRequestProblem(
  detail: string,
  instance?: string,
  code: string = ERROR_CODES.BAD_REQUEST
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/bad-request`,
    title: "Bad Request",
    status: 400,
    detail,
    instance,
    code,
  });
}

export function unauthorizedProblem(
  detail = "Unauthorized",
  instance?: string
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/unauthorized`,
    title: "Unauthorized",
    status: 401,
    detail,
    instance,
    code: ERROR_CODES.UNAUTHORIZED,
  });
}

export function forbiddenProblem(
  detail = "Forbidden",
  instance?: string,
  code: string = ERROR_CODES.FORBIDDEN
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/forbidden`,
    title: "Forbidden",
    status: 403,
    detail,
    instance,
    code,
  });
}

export function notFoundProblem(
  resource = "Resource",
  instance?: string
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/not-found`,
    title: "Not Found",
    status: 404,
    detail: `${resource} not found`,
    instance,
    code: ERROR_CODES.NOT_FOUND,
  });
}

export function conflictProblem(
  detail: string,
  instance?: string
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/conflict`,
    title: "Conflict",
    status: 409,
    detail,
    instance,
    code: ERROR_CODES.CONFLICT,
  });
}

export function serverProblem(
  detail = "Internal server error",
  instance?: string
): NextResponse {
  return problemResponse({
    type: `${PROBLEM_BASE_URI}/internal-error`,
    title: "Internal Server Error",
    status: 500,
    detail,
    instance,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
}

/**
 * Unified error handler that maps caught errors to RFC 7807 `application/problem+json` responses.
 */
export function handleProblemApiError(
  err: unknown,
  context?: string,
  instance?: string
): NextResponse {
  logger.error(context ?? "API error", {
    requestId: getCurrentRequestId(),
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (process.env.NEXT_PUBLIC_SENTRY_DSN && !(err instanceof z.ZodError)) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      component: context ?? "API",
    });
  }

  if (err instanceof z.ZodError) {
    return validationProblem(
      err,
      instance,
      err.issues.map((e) => e.message).join("; ") || "Request validation failed"
    );
  }

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
    return problemResponse({
      type: `${PROBLEM_BASE_URI}/${mapped.code.toLowerCase().replace(/_/g, "-")}`,
      title: DEFAULT_TITLES[mapped.status] ?? "Database Error",
      status: mapped.status,
      detail: mapped.message,
      instance,
      code: mapped.code,
    });
  }

  if (err && typeof err === "object" && "code" in err) {
    const prismaCode = (err as { code: string }).code;
    if (typeof prismaCode === "string" && prismaCode.startsWith("P")) {
      const mapped = handlePrismaError(err);
      return problemResponse({
        type: `${PROBLEM_BASE_URI}/${mapped.code.toLowerCase().replace(/_/g, "-")}`,
        title: DEFAULT_TITLES[mapped.status] ?? "Database Error",
        status: mapped.status,
        detail: mapped.message,
        instance,
        code: mapped.code,
      });
    }
  }

  const detail =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred."
      : err instanceof Error
        ? err.message
        : "An unexpected error occurred.";

  return serverProblem(detail, instance);
}
