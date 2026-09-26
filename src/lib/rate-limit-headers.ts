// SPDX-License-Identifier: MIT

/**
 * Rate limit header generation for API responses.
 *
 * Delegates to the unified rate-limit module (Issue #759).
 */

export {
  type RateLimitInfo,
  writeRateLimitHeaders,
  getRateLimitHeaders,
  isRateLimited,
} from "./rate-limit";
