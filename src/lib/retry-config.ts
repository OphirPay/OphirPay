// SPDX-License-Identifier: MIT

/**
 * Centralized retry configuration for API calls, contract interactions, and webhooks.
 */

export const RETRY_CONFIG = {
  /** Default max retry attempts */
  maxAttempts: 3,
  /** Base delay between retries (ms) */
  baseDelayMs: 1000,
  /** Maximum delay between retries (ms) */
  maxDelayMs: 30000,
  /** Webhook delivery retries (more generous) */
  webhook: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    timeoutMs: 5000,
  },
  /** Contract transaction polling */
  contract: {
    maxAttempts: 30,
    baseDelayMs: 1000,
    maxDelayMs: 2000,
    timeoutMs: 60000,
  },
} as const;
