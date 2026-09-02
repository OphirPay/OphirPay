// SPDX-License-Identifier: MIT

/**
 * localStorage and sessionStorage key constants.
 * Prevents typos and makes it easy to find all storage usage.
 */

export const STORAGE_KEYS = {
  /** OphirPay theme preference ("light" | "dark") */
  THEME: "ophirpay-theme",
  /** Wallet session (publicKey, network, lastConnected) */
  WALLET_SESSION: "ophirpay-wallet-session",
  /** Address book entries */
  ADDRESS_BOOK: "ophirpay-address-book",
  /** Feature flag overrides (dev only) */
  FEATURE_FLAG_PREFIX: "ff_",
  /** Current app version for cache busting */
  APP_VERSION: "ophirpay-version",
  /** A/B test experiment assignments */
  AB_TEST_PREFIX: "ab_",
  /** Wallet connected flag */
  WALLET_CONNECTED: "ophirpay-wallet-connected",
  /** Currency display preference ("XLM" | "USD") */
  CURRENCY_DISPLAY: "ophirpay-currency-display",
  /** In-app notification center data & read status */
  NOTIFICATIONS: "ophirpay-notifications",
  NOTIFICATIONS_READ: "ophirpay-notifications-read",
} as const;
