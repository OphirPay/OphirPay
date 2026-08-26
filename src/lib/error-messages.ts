// SPDX-License-Identifier: MIT

/**
 * User-facing error message catalog.
 * Centralized messages for consistent UX across the application.
 */

export const ERRORS = {
  WALLET_NOT_INSTALLED:
    "Freighter wallet is not installed. Please install the Freighter browser extension to continue.",
  WALLET_REJECTED: "Transaction was declined in Freighter. You can try again when ready.",
  WALLET_DISCONNECTED:
    "Wallet disconnected. Please reconnect your Freighter wallet to continue.",
  INSUFFICIENT_BALANCE: (balance: string, needed: string) =>
    `Insufficient balance. You have ${balance}, but need ${needed}.`,
  INVALID_ADDRESS: "Please enter a valid Stellar address (starts with G, 56 characters).",
  INVALID_AMOUNT: "Please enter a valid positive amount.",
  MEMO_TOO_LONG: "Memo must be 28 characters or fewer.",
  NETWORK_ERROR:
    "Network error — unable to reach the Stellar network. Please check your connection and try again.",
  CONTRACT_ERROR: "Smart contract execution failed. The contract may not be deployed or initialized.",
  SAME_ACCOUNT: "Cannot send to your own address.",
  BATCH_EMPTY: "Please add at least one recipient to the batch.",
  BATCH_TOO_LARGE: "A batch can contain at most 100 recipients.",
  DUPLICATE_ADDRESS: "Duplicate recipient address detected — each address must be unique.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  NOT_FOUND: "The requested resource was not found.",
  SERVER_ERROR: "An unexpected server error occurred. Please try again later.",
} as const;
