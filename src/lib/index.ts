// SPDX-License-Identifier: MIT

/**
 * Barrel export for the lib directory.
 * Re-exports commonly used utilities for convenient imports.
 */

// Validation & Schemas
export { createPaymentSchema, createBatchSchema, createRecurrenceSchema } from "./validation-schemas";
export { validateEnv, isProduction, getAppUrl } from "./env";

// API Helpers
export { successResponse, errorResponse, validationError, notFoundError, serverError } from "./api-response";
export { logger } from "./logger";

// Stellar
export { isValidStellarAddress, getStellarExplorerUrl, getAccountExplorerUrl, XLM_STROOPS } from "./stellar";
export { xlmToStroops, stroopsToXlm } from "./stellar-helpers";

// Utilities
export { cn, shortenAddress, formatAmount, formatDate, timeAgo, getStatusColor } from "./utils";
export { sanitizeHtml, escapeHtml, sanitizeStellarAddress } from "./sanitize";
export { cacheControl, CACHE_PRESETS } from "./cache";
export { getSecurityHeaders, getCorsHeaders } from "./headers";

// Contracts
export { classifyContractError, ContractErrorType, ContractError } from "./contracts";

// Constants
export { APP, STELLAR, UI, API } from "./constants";
export { ROUTES, API_ROUTES } from "./route-paths";
export { STORAGE_KEYS } from "./storage-keys";
export { ERROR_CODES } from "./error-codes";
export { ERRORS } from "./error-messages";
