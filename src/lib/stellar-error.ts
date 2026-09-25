// SPDX-License-Identifier: MIT

/**
 * Stellar Horizon error codes mapped to ErrorTaxonomyEntry.
 * Converts Horizon transaction result codes to structured taxonomy entries.
 */

import { ERROR_TAXONOMY, type ErrorTaxonomyEntry } from "./error-taxonomy";

export interface ClassifiedStellarError extends ErrorTaxonomyEntry {
  resultCode: string;
  recoverable: boolean;
}

const HORIZON_TAXONOMY_MAP: Record<string, { code: keyof typeof ERROR_TAXONOMY; customMessage?: string; recoverable: boolean }> = {
  op_underfunded: {
    code: "INSUFFICIENT_FUNDS",
    customMessage: "Insufficient funds to complete this transaction. Please top up your account.",
    recoverable: true,
  },
  op_low_reserve: {
    code: "INSUFFICIENT_RESERVE",
    customMessage: "Account would fall below the minimum reserve. Keep at least 1 XLM in your account.",
    recoverable: true,
  },
  op_no_trust: {
    code: "INVALID_TRUSTLINE",
    customMessage: "Trustline not established for this asset. You need to trust the asset issuer first.",
    recoverable: true,
  },
  op_no_issuer: {
    code: "ASSET_NOT_FOUND",
    customMessage: "The asset issuer account does not exist.",
    recoverable: false,
  },
  op_src_no_trust: {
    code: "INVALID_TRUSTLINE",
    customMessage: "Source account has not established a trustline for this asset.",
    recoverable: true,
  },
  op_src_not_authorized: {
    code: "INSUFFICIENT_PERMISSIONS",
    customMessage: "Source account is not authorized to send this asset.",
    recoverable: false,
  },
  op_not_authorized: {
    code: "INSUFFICIENT_PERMISSIONS",
    customMessage: "Destination account is not authorized to receive this asset.",
    recoverable: false,
  },
  op_line_full: {
    code: "AMOUNT_EXCEEDS_MAXIMUM",
    customMessage: "Trustline limit reached. The recipient cannot receive more of this asset.",
    recoverable: false,
  },
  tx_bad_seq: {
    code: "SEQUENCE_NUMBER_MISMATCH",
    customMessage: "Transaction sequence number is invalid. Try refreshing and send again.",
    recoverable: true,
  },
  tx_bad_auth: {
    code: "INVALID_SIGNATURE",
    customMessage: "Invalid signature. Please sign with the correct account.",
    recoverable: true,
  },
  tx_too_late: {
    code: "TRANSACTION_EXPIRED",
    customMessage: "Transaction expired. Your time window to sign has passed — please try again.",
    recoverable: true,
  },
  tx_too_early: {
    code: "INVALID_TIMESTAMP",
    customMessage: "Transaction submitted too early. Check your device clock.",
    recoverable: true,
  },
  tx_insufficient_fee: {
    code: "TRANSACTION_FAILED",
    customMessage: "Transaction fee is too low. The network requires a higher fee.",
    recoverable: true,
  },
  tx_insufficient_balance: {
    code: "INSUFFICIENT_FUNDS",
    customMessage: "Insufficient balance to cover the transaction fee.",
    recoverable: true,
  },
  tx_memo_required: {
    code: "MEMO_REQUIRED",
    customMessage: "This account requires a memo to receive payments. Please add a memo.",
    recoverable: true,
  },
};

/**
 * Classify a Horizon error result code into a structured taxonomy entry.
 */
export function parseStellarError(resultCode: string): ClassifiedStellarError {
  for (const [key, mapping] of Object.entries(HORIZON_TAXONOMY_MAP)) {
    if (resultCode.includes(key)) {
      const taxonomyEntry = ERROR_TAXONOMY[mapping.code];
      return {
        ...taxonomyEntry,
        message: mapping.customMessage || taxonomyEntry.message,
        resultCode,
        recoverable: mapping.recoverable,
      };
    }
  }

  const fallback = ERROR_TAXONOMY.STELLAR_ERROR;
  return {
    ...fallback,
    message: `Transaction failed (${resultCode}). Please check your inputs and try again.`,
    resultCode,
    recoverable: isRecoverableStellarError(resultCode),
  };
}

/**
 * Map a Horizon error result code to a user-friendly message.
 * Falls back to the original code if no mapping exists.
 */
export function getStellarErrorMessage(resultCode: string): string {
  return parseStellarError(resultCode).message;
}

/**
 * Check if a Stellar error is recoverable (user can fix and retry).
 */
export function isRecoverableStellarError(message: string): boolean {
  const recoverable = [
    "underfunded",
    "reserve",
    "sequence",
    "expired",
    "insufficient",
  ];
  return recoverable.some((r) => message.toLowerCase().includes(r));
}
