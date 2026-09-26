// SPDX-License-Identifier: MIT

/**
 * Rate limiting for wallet and address lookup endpoints.
 *
 * Delegates to the unified rate-limit module (Issue #759).
 */

export {
  type LookupRateLimitConfig,
  type LookupRateLimitOptions,
  enforceLookupRateLimit,
} from "./rate-limit";
