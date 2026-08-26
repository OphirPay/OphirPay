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
} as const;
