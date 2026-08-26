// SPDX-License-Identifier: MIT

import { Prisma } from "@prisma/client";

/**
 * Human-readable Prisma error mapper.
 * Converts Prisma client errors into user-friendly messages for API responses.
 */

export function handlePrismaError(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return {
          code: "UNIQUE_CONSTRAINT",
          message: `A record with this ${(err.meta?.target as string[])?.join(", ") || "field"} already exists.`,
          status: 409,
        };
      case "P2025":
        return { code: "NOT_FOUND", message: "Record not found.", status: 404 };
      case "P2003":
        return { code: "FOREIGN_KEY", message: "Related record not found.", status: 400 };
      case "P2014":
        return { code: "RELATION_VIOLATION", message: "Cannot delete — related records exist.", status: 409 };
      default:
        return { code: "DATABASE_ERROR", message: "A database error occurred.", status: 500 };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return { code: "VALIDATION_ERROR", message: "Invalid data provided.", status: 400 };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return { code: "DB_CONNECTION", message: "Database connection failed.", status: 503 };
  }

  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", status: 500 };
}
