// SPDX-License-Identifier: MIT

/**
 * Application-wide constants used across OphirPay.
 */

export const APP = {
  NAME: "OphirPay",
  VERSION: "0.1.0",
  DESCRIPTION: "The Open-Source Payment Orchestration Layer for Stellar",
  REPO: "https://github.com/OphirPay/OphirPay",
} as const;

export const STELLAR = {
  /** Maximum operations per Stellar transaction */
  MAX_OPS_PER_TX: 100,
  /** Maximum memo length in bytes */
  MAX_MEMO_LENGTH: 28,
  /** Stellar address format */
  ADDRESS_PATTERN: /^G[A-Z0-9]{55}$/,
  /** Stroops per XLM */
  XLM_STROOPS: 10_000_000,
  /** Minimum account reserve in XLM */
  MIN_RESERVE: 1,
} as const;

export const UI = {
  /** Toast auto-dismiss duration in ms */
  TOAST_DURATION: 5000,
  /** Maximum visible toasts */
  MAX_TOASTS: 4,
  /** Debounce delay for search inputs in ms */
  SEARCH_DEBOUNCE: 300,
  /** Polling interval for live data in ms */
  POLL_INTERVAL: 10_000,
} as const;

export const API = {
  /** Default page size */
  DEFAULT_PAGE_SIZE: 20,
  /** Maximum page size */
  MAX_PAGE_SIZE: 100,
  /** Rate limit: requests per minute */
  RATE_LIMIT_RPM: 120,
} as const;
