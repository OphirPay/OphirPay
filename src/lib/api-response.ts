// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { z } from "zod";
import { handlePrismaError } from "@/lib/prisma-errors";
import { logger } from "@/lib/logger";
import { getCurrentRequestId } from "@/lib/request-logging";
import { ERROR_CODES } from "@/lib/error-codes";

// ── Standard Response Types ────────────────────────────────────

interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    timestamp?: string;
    /** Opaque cursor for the next page (keyset pagination). */
    nextCursor?: string | null;
    /** Whether more rows exist after this page. */
    hasMore?: boolean;
  };
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

// ── BigInt-safe JSON ───────────────────────────────────────────

/**
 * Recursively convert BigInt values into JSON-serializable values.
 * Soroban contract reads (scValToNative) return BigInts for u64/i64/i128
 * fields; JSON.stringify throws on BigInt, which crashed several
 * contract-read routes with "Do not know how to serialize a BigInt".
 *
 * Values within the safe integer range become numbers; larger values
 * become strings to avoid precision loss (e.g. i128 stroop amounts).
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  // Dates must be serialized before the object branch: Object.entries() on a
  // Date is empty, which would otherwise silently turn it into {}.
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] = jsonSafe(val);
    }
    return out;
  }
  return value;
}

// ── Response Helpers ───────────────────────────────────────────

export function successResponse<T>(
  data: T,
  meta?: ApiSuccess<T>["meta"],
  status = 200,
  cacheHeader?: string
) {
  const response = NextResponse.json(
    {
      success: true,
      data: jsonSafe(data) as T,
      meta: { timestamp: new Date().toISOString(), ...meta },
    } satisfies ApiSuccess<T>,
    { status }
  );
  if (cacheHeader) {
    response.headers.set("Cache-Control", cacheHeader);
  }
  return response;
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: unknown
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message, details: details ? jsonSafe(details) : undefined },
      timestamp: new Date().toISOString(),
    } satisfies ApiError,
    { status }
  );
}

export function validationError(err: z.ZodError) {
  return errorResponse(
    ERROR_CODES.VALIDATION_ERROR,
    "Request validation failed",
    400,
    err.issues.map((e) => ({ path: e.path.join("."), message: e.message }))
  );
}

export function notFoundError(resource = "Resource") {
  return errorResponse(ERROR_CODES.NOT_FOUND, `${resource} not found`, 404);
}

export function serverError(message = "Internal server error") {
  return errorResponse(ERROR_CODES.INTERNAL_ERROR, message, 500);
}

export function unauthorizedError(message = "Unauthorized") {
  return errorResponse(ERROR_CODES.UNAUTHORIZED, message, 401);
}

export function rateLimitError(message = "Too many requests") {
  return errorResponse(ERROR_CODES.RATE_LIMITED, message, 429);
}

export function conflictError(message: string) {
  return errorResponse(ERROR_CODES.CONFLICT, message, 409);
}

export function badRequestError(message: string) {
  return errorResponse(ERROR_CODES.BAD_REQUEST, message, 400);
}

// ── Unified Error Handler ──────────────────────────────────────

/**
 * Map any caught error to a proper API error response.
 *
 * • Prisma errors → correct HTTP status (404, 409, 503, etc.)
 * • Zod validation errors → 400 with field details
 * • Generic errors → 500 (masked in production for security)
 */
export function handleApiError(err: unknown, context?: string): NextResponse {
  // Log the real error for debugging — the request id (set by the request
  // logging middleware) lets operators correlate the log with the
  // X-Request-Id returned to the client.
  logger.error(context ?? "API error", {
    requestId: getCurrentRequestId(),
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  // Zod validation errors (check first — before Prisma instance checks)
  if (err instanceof z.ZodError) {
    return errorResponse(
      ERROR_CODES.VALIDATION_ERROR,
      err.issues.map((e) => e.message).join("; "),
      400
    );
  }

  // Prisma errors — use handlePrismaError which knows all Prisma error types
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
    return errorResponse(mapped.code, mapped.message, mapped.status);
  }

  // Fallback for Prisma errors detected by code pattern
  if (err && typeof err === "object" && "code" in err) {
    const prismaCode = (err as { code: string }).code;
    if (typeof prismaCode === "string" && prismaCode.startsWith("P")) {
      const mapped = handlePrismaError(err);
      return errorResponse(mapped.code, mapped.message, mapped.status);
    }
  }

  // Generic — mask the message in production
  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred."
      : err instanceof Error
        ? err.message
        : "An unexpected error occurred.";

  return serverError(message);
}
