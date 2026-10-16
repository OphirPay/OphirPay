// SPDX-License-Identifier: MIT

/**
 * ARIA label constants for consistent accessibility across the application.
 */

export const ARIA = {
  /** Navigation */
  TOGGLE_MENU: "Toggle menu",
  CLOSE_MENU: "Close menu",
  SKIP_TO_CONTENT: "Skip to main content",

  /** Wallet */
  CONNECT_WALLET: "Connect wallet",
  DISCONNECT_WALLET: "Disconnect wallet",
  REFRESH_BALANCE: "Refresh balance",
  COPY_ADDRESS: "Copy wallet address",

  /** Actions */
  CLOSE_DIALOG: "Close dialog",
  DISMISS_NOTIFICATION: "Dismiss notification",
  SCROLL_TO_TOP: "Scroll to top",
  TOGGLE_THEME: "Toggle dark mode",
  SEARCH: "Search",

  /** Status */
  LOADING: "Loading",
  SUCCESS: "Success",
  ERROR: "Error",
  WARNING: "Warning",

  /** Transaction & Wallet Live Announcements */
  WALLET_CONNECTING: "Connecting to wallet",
  WALLET_CONNECTED: "Wallet connected successfully",
  WALLET_DISCONNECTED: "Wallet disconnected",
  WALLET_CONNECTION_ERROR: "Wallet connection failed",
  TRANSACTION_SIGNING: "Waiting for wallet signature",
  TRANSACTION_SUBMITTING: "Submitting transaction to network",
  TRANSACTION_CONFIRMED: "Transaction confirmed on-chain",
  TRANSACTION_FAILED: "Transaction failed",
} as const;
