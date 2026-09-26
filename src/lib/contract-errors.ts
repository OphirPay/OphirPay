// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run `npm run generate-errors` to update.

/**
 * Soroban contract error decoding utilities.
 * Maps raw contract error codes to human-readable messages.
 * Mirrors the PaymentError enum in contracts/ophirpay/src/lib.rs.
 */

export const CONTRACT_ERROR_MAP: Record<string, string> = {
  "1": "Contract not initialized: call init() first",
  "2": "Contract already initialized",
  "3": "Payment not found",
  "4": "Unauthorized: caller does not have permission",
  "5": "Invalid amount: must be greater than zero",
  "6": "Escrow not yet due: deadline has not passed",
  "7": "Escrow already released",
  "8": "Escrow not found",
  "9": "Stream not started: start time is in the future",
  "10": "Stream already cancelled",
  "11": "Stream not found",
  "12": "Stream fully claimed: no remaining balance",
  "13": "Batch too large: exceeds maximum recipients",
  "14": "Batch empty: no recipients provided",
  "17": "Payment already cancelled",
  "18": "Contract paused: operations are temporarily disabled",
  "19": "No tokens available to withdraw",
  "20": "Upgrade not proposed: call propose_upgrade() first",
  "21": "Upgrade timelock active: 24-hour delay has not elapsed",
  "22": "Multisig not configured: call set_multisig_config() first",
  "23": "Not a signer: you are not in the multisig signer list",
  "24": "Already approved: duplicate approval detected",
  "25": "Threshold not met: insufficient approvals",
  "26": "Already executed: this action has already been processed",
  "27": "Not a role holder: insufficient RBAC permissions",
  "29": "Audit entry not found",
  "30": "Recurring payment not found",
  "31": "Recurring payment not yet due",
  "32": "Recurring payment already cancelled",
  "35": "Fee too high: exceeds maximum 1000 bps (10%)",
  "36": "Timelocked action not found",
  "37": "Timelocked action not yet due: 24-hour delay has not elapsed",
  "38": "Timelocked action already executed",
  "39": "Governance not configured: call configure_governance() first",
  "40": "Proposal not found",
  "41": "Voting period ended: proposal is closed",
  "42": "Proposal already executed",
  "45": "Deposit too low: must meet minimum proposal deposit",
  "46": "Spending limit expired: limit has been deactivated or expired",
  "47": "Refund not found",
  "48": "Refund already processed",
  "51": "Already voted: duplicate vote on proposal",
  "52": "Reentrant call detected: operation blocked by reentrancy guard",
  "62": "Hook not found",
  "65": "Asset not supported: invalid or unapproved asset address",
  "91": "Maximum signers exceeded",
  "301": "Revocation not found",
  "302": "Revocation not due",
  "303": "Revocation already executed",
  "304": "Cannot revoke self",
  "305": "No pending ownership transfer",
  "306": "Math overflow",
  "307": "Stream accounting invariant violated: refused to pay an inconsistent amount",
  "308": "Pause scope not recognized: unknown scope identifier",
};

/**
 * Attempt to decode a Soroban contract error from a diagnostic event
 * or raw error value. Falls back to the raw value if unknown.
 */
export function decodeContractError(rawError: string): string {
  const trimmed = rawError.trim();

  // Check for Error(Contract, #N) pattern
  const codeMatch = trimmed.match(/Error\(Contract,\s*#(\d+)\)/);
  if (codeMatch && CONTRACT_ERROR_MAP[codeMatch[1]]) {
    return CONTRACT_ERROR_MAP[codeMatch[1]];
  }

  // Check for numeric error codes from diagnostic events
  if (CONTRACT_ERROR_MAP[trimmed]) {
    return CONTRACT_ERROR_MAP[trimmed];
  }

  // Return raw error if we can't decode it
  return rawError;
}

/**
 * Get all known contract errors for documentation / tooltips.
 */
export function getContractErrorCatalog(): { code: string; message: string }[] {
  return Object.entries(CONTRACT_ERROR_MAP)
    .map(([code, message]) => ({ code, message }))
    .sort((a, b) => parseInt(a.code) - parseInt(b.code));
}
