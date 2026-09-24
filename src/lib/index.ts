// SPDX-License-Identifier: MIT

/**
 * Barrel export for the lib directory.
 * Re-exports commonly used utilities for convenient imports.
 */

// Validation & Schemas
export {
  createPaymentSchema,
  createBatchSchema,
  createRecurrenceSchema,
} from "./validation-schemas";
export { validateEnv, isProduction, getAppUrl } from "./env";

// API Helpers
export {
  successResponse,
  errorResponse,
  validationError,
  notFoundError,
  serverError,
} from "./api-response";
export { logger } from "./logger";

// Stellar
export {
  isValidStellarAddress,
  getStellarExplorerUrl,
  getAccountExplorerUrl,
  XLM_STROOPS,
} from "./stellar";
export { xlmToStroops, stroopsToXlm } from "./stellar-helpers";

// Utilities
export { cn, shortenAddress, formatAmount, formatDate, timeAgo, getStatusColor } from "./utils";
export { sanitizeHtml, escapeHtml, sanitizeStellarAddress } from "./sanitize";
export { cacheControl, CACHE_PRESETS } from "./cache";
export { getSecurityHeaders, getCorsHeaders } from "./headers";
export {
  fetchXlmPrice,
  convertXlmToUsd,
  formatFiatAmount,
  formatPriceOrAsset,
  formatPriceUnavailableFallback,
  clearPriceCache,
  setCachedPrice,
  getPriceProviderApiKey,
  ROUNDING_RULES,
  PRICE_CACHE_TTL_MS,
  PRICE_STALE_THRESHOLD_MS,
  PRICE_BACKOFF_MS,
  DEFAULT_PRICE_TIMEOUT_MS,
} from "./price";
export type {
  PriceResult,
  PriceStaleReason,
  FetchXlmPriceOptions,
  FormatFiatOptions,
  FormatPriceOrAssetOptions,
  FormattedPriceOrAsset,
} from "./price";

// Contracts
export { classifyContractError, ContractErrorType, ContractError } from "./contracts";

// Constants
export { APP, STELLAR, UI, API } from "./constants";
export { ROUTES, API_ROUTES } from "./route-paths";
export { STORAGE_KEYS } from "./storage-keys";
export { ERROR_CODES } from "./error-codes";
export { ERRORS } from "./error-messages";
