// SPDX-License-Identifier: MIT

/**
 * Rate limiting for wallet-auth endpoints (GET /api/auth/challenge and
 * POST /api/auth/session).
 *
 * Delegates to the unified rate-limit module (Issue #759).
 */

export {
  type AuthRateLimitConfig,
  type AuthRateLimitOptions,
  enforceAuthRateLimit,
} from "./rate-limit";
