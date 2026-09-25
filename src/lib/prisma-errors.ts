// SPDX-License-Identifier: MIT

import { Prisma } from "@prisma/client";
import {
  ERROR_TAXONOMY,
  type ErrorTaxonomyEntry,
} from "./error-taxonomy";

export interface ClassifiedPrismaError extends ErrorTaxonomyEntry {
  prismaCode?: string;
  meta?: Record<string, unknown>;
}

/**
 * Human-readable Prisma error mapper.
 * Converts Prisma client errors into unified error taxonomy entries.
 */
export function handlePrismaError(err: unknown): ClassifiedPrismaError {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": {
        const target = (err.meta?.target as string[])?.join(", ") || "field";
        const entry = ERROR_TAXONOMY.UNIQUE_CONSTRAINT;
        return {
          code: entry.code,
          status: entry.status,
          message: `A record with this ${target} already exists.`,
          template: entry.template,
          category: entry.category,
          prismaCode: err.code,
          meta: err.meta as Record<string, unknown> | undefined,
        };
      }
      case "P2025":
        return {
          ...ERROR_TAXONOMY.NOT_FOUND,
          message: "Record not found.",
          prismaCode: err.code,
          meta: err.meta as Record<string, unknown> | undefined,
        };
      case "P2003":
        return {
          ...ERROR_TAXONOMY.FOREIGN_KEY,
          prismaCode: err.code,
          meta: err.meta as Record<string, unknown> | undefined,
        };
      case "P2014":
        return {
          ...ERROR_TAXONOMY.RELATION_VIOLATION,
          prismaCode: err.code,
          meta: err.meta as Record<string, unknown> | undefined,
        };
      default:
        return {
          ...ERROR_TAXONOMY.DATABASE_ERROR,
          prismaCode: err.code,
          meta: err.meta as Record<string, unknown> | undefined,
        };
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return {
      ...ERROR_TAXONOMY.VALIDATION_ERROR,
      message: "Invalid data provided.",
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      ...ERROR_TAXONOMY.DB_CONNECTION,
    };
  }

  return {
    ...ERROR_TAXONOMY.INTERNAL_ERROR,
    message: "An unexpected error occurred.",
  };
}

export const parsePrismaError = handlePrismaError;

