// SPDX-License-Identifier: MIT

/**
 * Centralized API error codes and status mappings derived from ERROR_TAXONOMY.
 *
 * Implements Issue #760:
 * - Single error taxonomy defined in src/lib/error-taxonomy.ts.
 * - ERROR_CODES and ERROR_STATUS are derived directly from the taxonomy table.
 * - Adding a new error requires editing one table in error-taxonomy.ts.
 */

import {
  ERROR_TAXONOMY,
  type ErrorTaxonomyEntry,
  type ErrorTaxonomyCode,
  getTaxonomyEntry,
  formatErrorMessage,
  createTaxonomyError,
} from "./error-taxonomy";

export {
  ERROR_TAXONOMY,
  type ErrorTaxonomyEntry,
  type ErrorTaxonomyCode,
  getTaxonomyEntry,
  formatErrorMessage,
  createTaxonomyError,
};

export const ERROR_CODES = Object.fromEntries(
  Object.keys(ERROR_TAXONOMY).map((k) => [k, k])
) as { readonly [K in ErrorTaxonomyCode]: K };

export type ErrorCode = ErrorTaxonomyCode;

/** HTTP status codes for each error code, derived directly from the taxonomy */
export const ERROR_STATUS: Record<string, number> = Object.fromEntries(
  Object.values(ERROR_TAXONOMY).map((entry) => [entry.code, entry.status])
);
