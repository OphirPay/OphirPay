// SPDX-License-Identifier: MIT

/**
 * User-facing error message catalog mapped directly from ERROR_TAXONOMY.
 * Centralized messages for consistent UX across the application.
 */

import { ERROR_TAXONOMY, formatErrorMessage, type ErrorTaxonomyCode } from "./error-taxonomy";

export const ERROR_MESSAGES: Record<string, string> = Object.fromEntries(
  Object.values(ERROR_TAXONOMY).map((entry) => [entry.code, entry.message])
);

export function getErrorMessage(
  code: string,
  params?: Record<string, string | number>
): string {
  const entry = ERROR_TAXONOMY[code as keyof typeof ERROR_TAXONOMY];
  if (!entry) return "An unexpected error occurred.";
  return formatErrorMessage(code, params);
}

export const ERRORS = {
  WALLET_NOT_INSTALLED: ERROR_TAXONOMY.WALLET_NOT_INSTALLED.message,
  WALLET_REJECTED: ERROR_TAXONOMY.WALLET_SIGN_REJECTED.message,
  WALLET_DISCONNECTED: ERROR_TAXONOMY.WALLET_DISCONNECTED.message,
  INSUFFICIENT_BALANCE: (balance: string, needed: string) =>
    formatErrorMessage("INSUFFICIENT_FUNDS", { balance, needed }),
  INVALID_ADDRESS: ERROR_TAXONOMY.INVALID_ADDRESS.message,
  INVALID_AMOUNT: ERROR_TAXONOMY.INVALID_AMOUNT.message,
  MEMO_TOO_LONG: ERROR_TAXONOMY.MEMO_TOO_LONG.message,
  NETWORK_ERROR: ERROR_TAXONOMY.NETWORK_ERROR.message,
  CONTRACT_ERROR: ERROR_TAXONOMY.CONTRACT_ERROR.message,
  SAME_ACCOUNT: ERROR_TAXONOMY.SELF_PAYMENT.message,
  BATCH_EMPTY: "Please add at least one recipient to the batch.",
  BATCH_TOO_LARGE: ERROR_TAXONOMY.BATCH_TOO_LARGE.message,
  DUPLICATE_ADDRESS: "Duplicate recipient address detected — each address must be unique.",
  RATE_LIMITED: ERROR_TAXONOMY.RATE_LIMITED.message,
  NOT_FOUND: ERROR_TAXONOMY.NOT_FOUND.message,
  SERVER_ERROR: ERROR_TAXONOMY.INTERNAL_ERROR.message,
} as const;
