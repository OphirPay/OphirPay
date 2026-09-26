// SPDX-License-Identifier: MIT
//
// Prisma failure classifier.
//
// This module parses Prisma client errors, but it no longer decides the HTTP
// status or the default copy — it maps each failure into the shared taxonomy
// (`error-codes.ts`, issue #760). `api-response.ts` is the only place that
// serializes the envelope.

import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  getErrorDefinition,
  type ErrorCode,
} from "@/lib/error-codes";

export interface ClassifiedError {
  code: string;
  message: string;
  status: number;
}

function fromTaxonomy(code: ErrorCode, message?: string): ClassifiedError {
  const definition = getErrorDefinition(code);
  return {
    code: definition.code,
    status: definition.status,
    message: message ?? definition.message,
  };
}

/**
 * Human-readable Prisma error mapper.
 * Converts Prisma client errors into classified errors for API responses.
 */
export function handlePrismaError(err: unknown): ClassifiedError {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return fromTaxonomy(
          ERROR_CODES.UNIQUE_CONSTRAINT,
          `A record with this ${(err.meta?.target as string[])?.join(", ") || "field"} already exists.`,
        );
      case "P2025":
        return fromTaxonomy(ERROR_CODES.NOT_FOUND, "Record not found.");
      case "P2003":
        return fromTaxonomy(ERROR_CODES.FOREIGN_KEY, "Related record not found.");
      case "P2014":
        return fromTaxonomy(
          ERROR_CODES.RELATION_VIOLATION,
          "Cannot delete — related records exist.",
        );
      default:
        return fromTaxonomy(ERROR_CODES.DATABASE_ERROR);
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return fromTaxonomy(ERROR_CODES.VALIDATION_ERROR, "Invalid data provided.");
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return fromTaxonomy(ERROR_CODES.DB_CONNECTION, "Database connection failed.");
  }

  return fromTaxonomy(ERROR_CODES.INTERNAL_ERROR);
}
