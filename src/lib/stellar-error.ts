// SPDX-License-Identifier: MIT

/**
 * Stellar Horizon error codes and user-friendly messages.
 * Maps Horizon transaction result codes to human-readable explanations.
 */

const HORIZON_ERROR_MESSAGES: Record<string, string> = {
  op_underfunded: "Insufficient funds to complete this transaction. Please top up your account.",
  op_low_reserve: "Account would fall below the minimum reserve. Keep at least 1 XLM in your account.",
  op_no_trust: "Trustline not established for this asset. You need to trust the asset issuer first.",
  op_no_issuer: "The asset issuer account does not exist.",
  op_src_no_trust: "Source account has not established a trustline for this asset.",
  op_src_not_authorized: "Source account is not authorized to send this asset.",
  op_not_authorized: "Destination account is not authorized to receive this asset.",
  op_line_full: "Trustline limit reached. The recipient cannot receive more of this asset.",
  tx_bad_seq: "Transaction sequence number is invalid. Try refreshing and send again.",
  tx_bad_auth: "Invalid signature. Please sign with the correct account.",
  tx_too_late: "Transaction expired. Your time window to sign has passed — please try again.",
  tx_too_early: "Transaction submitted too early. Check your device clock.",
  tx_insufficient_fee: "Transaction fee is too low. The network requires a higher fee.",
  tx_insufficient_balance: "Insufficient balance to cover the transaction fee.",
};

/**
 * Map a Horizon error result code to a user-friendly message.
 * Falls back to the original code if no mapping exists.
 */
export function getStellarErrorMessage(resultCode: string): string {
  // Extract the operation-level code from full result codes like "op_underfunded"
  for (const [code, message] of Object.entries(HORIZON_ERROR_MESSAGES)) {
    if (resultCode.includes(code)) return message;
  }
  return `Transaction failed (${resultCode}). Please check your inputs and try again.`;
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
