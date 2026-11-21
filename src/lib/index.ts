// SPDX-License-Identifier: MIT

/**
 * Barrel export for the lib directory.
 * Re-exports commonly used utilities for convenient imports.
 */

// Validation & Schemas
export { getAppUrl,isProduction, validateEnv } from "./env";
export {
  createBatchSchema,
  createPaymentSchema,
  createRecurrenceSchema,
} from "./validation-schemas";

// API Helpers
export {
  errorResponse,
  notFoundError,
  serverError,
  successResponse,
  validationError,
} from "./api-response";
export { logger } from "./logger";

// Stellar
export {
  getAccountExplorerUrl,
  getStellarExplorerUrl,
  isValidStellarAddress,
  XLM_STROOPS,
} from "./stellar";
export { stroopsToXlm,xlmToStroops } from "./stellar-helpers";

// Utilities
export { CACHE_PRESETS,cacheControl } from "./cache";
export { getCorsHeaders,getSecurityHeaders } from "./headers";
export type { FormatFiatOptions,PriceResult } from "./price";
export {
  clearPriceCache,
  convertXlmToUsd,
  fetchXlmPrice,
  formatFiatAmount,
  ROUNDING_RULES,
} from "./price";
export { escapeHtml, sanitizeHtml, sanitizeStellarAddress } from "./sanitize";
export { cn, formatAmount, formatDate, getStatusColor,shortenAddress, timeAgo } from "./utils";

// Contracts
export { classifyContractError, ContractError,ContractErrorType } from "./contracts";

// Constants
export { API,APP, STELLAR, UI } from "./constants";
export { ERROR_CODES } from "./error-codes";
export { ERRORS } from "./error-messages";
export { API_ROUTES,ROUTES } from "./route-paths";
export { STORAGE_KEYS } from "./storage-keys";
