// SPDX-License-Identifier: MIT

/**
 * Advanced contract interaction helpers for multisig, governance,
 * recurring payments, and audit log queries.
 * 
 * These wire the Soroban OphirPayContract directly through Freighter signing
 * instead of API route stubs.
 */

import {
  Asset,
  nativeToScVal,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  invokeContractFunction,
  submitContractInvocation,
  simulateContractCall,
  DEFAULT_CONTRACT_ID,
  EMITTER_CONTRACT_ID,
  classifyContractError,
} from "@/lib/contracts";
import { getActiveWalletConnector } from "@/lib/wallets";
import { NETWORK_PASSPHRASE, STELLAR_NETWORK } from "@/lib/stellar";

/** Resolve contract ID — env var or hardcoded Testnet fallback */
const CONTRACT_ID = DEFAULT_CONTRACT_ID;
export const EMITTER_ID = EMITTER_CONTRACT_ID;

// ── Types ──────────────────────────────────────────────────────

/**
 * Result of a contract invocation submitted on-chain.
 * Mirrors the Soroban transaction lifecycle: simulation → signing → submission.
 */
export interface ContractCallResult {
  success: boolean;
  /** Soroban transaction hash on success (hex string) */
  txHash?: string;
  /** Contract return value deserialized (varies by function) */
  data?: unknown;
  /** Human-readable error message on failure */
  error?: string;
}

// ── Signing Helper ─────────────────────────────────────────────

/**
 * Build, simulate, sign, and submit a Soroban contract invocation.
 * Orchestrates the full lifecycle: ScVal encoding → simulation →
 * Freighter/xBull/Albedo signing → submission → result parsing.
 *
 * @param sourcePublicKey - Stellar public key authorizing the invocation
 * @param contractId - Soroban contract address
 * @param functionName - Contract entrypoint name (snake_case)
 * @param args - Pre-encoded xdr.ScVal arguments
 * @returns ContractCallResult with success/failure and optional txHash
 */
async function signAndSubmit(
  sourcePublicKey: string,
  contractId: string,
  functionName: string,
  args: xdr.ScVal[] = [],
): Promise<ContractCallResult> {
  const wallet = getActiveWalletConnector();
  if (!wallet) {
    return {
      success: false,
      error:
        "No wallet available. Install a Stellar wallet (Freighter, xBull, Rabet, Albedo, or Lobstr) and connect it.",
    };
  }

  try {
    const txInfo = await invokeContractFunction(
      contractId,
      functionName,
      sourcePublicKey,
      args,
    );

    if (txInfo.status !== "AWAITING_SIGNATURE" || !txInfo.xdr) {
      return { success: false, error: "Failed to build transaction" };
    }

    const signedXdr = await wallet.signTransaction(txInfo.xdr, {
      network: STELLAR_NETWORK,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    const result = await submitContractInvocation(signedXdr);
    return {
      success: result.status === "SUCCESS",
      txHash: result.txHash,
      // The contract's return value (e.g. the on-chain proposal/request id
      // returned by create_proposal / propose_payment) when available.
      data: result.returnValue,
    };
  } catch (err) {
    const ce = classifyContractError(err);
    return { success: false, error: ce.message };
  }
}

// ── Multisig Functions ─────────────────────────────────────────

export async function setMultisigConfig(
  caller: string,
  threshold: number,
  signers: string[],
  enabled: boolean,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(threshold, { type: "u32" }),
    nativeToScVal(signers, { type: "vec" }),
    nativeToScVal(enabled, { type: "bool" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "set_multisig_config", args);
}

export async function proposeMultisigPayment(
  caller: string,
  payee: string,
  amount: number,
  asset: string,
  txHash: string,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(payee, { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(asset, { type: "address" }),
    nativeToScVal(txHash, { type: "string" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "propose_payment", args);
}

export async function approveMultisigPayment(
  signer: string,
  requestId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(signer, { type: "address" }),
    nativeToScVal(requestId, { type: "u64" }),
  ];
  return signAndSubmit(signer, CONTRACT_ID, "approve_payment", args);
}

export async function executeApprovedPayment(
  caller: string,
  requestId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(requestId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "execute_approved_payment", args);
}

// ── Governance Functions ───────────────────────────────────────

/**
 * Resolve the SAC (Stellar Asset Contract) address for the proposal deposit.
 * An empty asset resolves to native XLM's SAC address — passing the proposer
 * (the previous fallback) would make the contract call token::transfer on the
 * proposer's *address*, which is not a token contract and always fails.
 */
function resolveDepositAssetAddress(asset: string): string {
  if (asset && asset.trim() !== "") return asset.trim();
  return Asset.native().contractId(NETWORK_PASSPHRASE);
}

export async function createGovernanceProposal(
  proposer: string,
  title: string,
  description: string,
  actionType: string,
  target: string,
  data: string,
  depositAsset: string = "",
  depositAmount: number = 0,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(proposer, { type: "address" }),
    nativeToScVal(title, { type: "string" }),
    nativeToScVal(description, { type: "string" }),
    nativeToScVal(actionType, { type: "string" }),
    nativeToScVal(target, { type: "string" }),
    nativeToScVal(data, { type: "string" }),
    nativeToScVal(resolveDepositAssetAddress(depositAsset), { type: "address" }),
    nativeToScVal(depositAmount, { type: "i128" }),
  ];
  return signAndSubmit(proposer, CONTRACT_ID, "create_proposal", args);
}

export async function voteOnProposal(
  voter: string,
  proposalId: number,
  support: boolean,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(voter, { type: "address" }),
    nativeToScVal(proposalId, { type: "u64" }),
    nativeToScVal(support, { type: "bool" }),
  ];
  return signAndSubmit(voter, CONTRACT_ID, "vote_on_proposal", args);
}

export async function executeGovernanceProposal(
  caller: string,
  proposalId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(proposalId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "execute_proposal", args);
}

// ── Recurring Functions ────────────────────────────────────────

export async function createRecurringPayment(
  creator: string,
  payee: string,
  amount: number,
  asset: string,
  schedule: string, // "Daily" | "Weekly" | "Monthly"
  remaining: number,
  metadata: string,
): Promise<ContractCallResult> {
  const scheduleMap: Record<string, number> = { Daily: 0, Weekly: 1, Monthly: 2 };
  const args: xdr.ScVal[] = [
    nativeToScVal(creator, { type: "address" }),
    nativeToScVal(payee, { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(asset, { type: "address" }),
    nativeToScVal(scheduleMap[schedule] ?? 0, { type: "u32" }),
    nativeToScVal(remaining, { type: "u32" }),
    nativeToScVal(metadata, { type: "string" }),
  ];
  return signAndSubmit(creator, CONTRACT_ID, "create_recurring", args);
}

export async function cancelRecurringPayment(
  caller: string,
  recurringId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(recurringId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "cancel_recurring", args);
}

// ── Utility: Read-Only Simulation Helpers ──────────────────────

/**
 * Simulate reading contract stats (read-only, no wallet needed).
 */
export async function readContractStats(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_stats", sourcePublicKey);
}

/**
 * Simulate reading audit log count.
 */
export async function readAuditLogCount(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_audit_log_count", sourcePublicKey);
}

// ── Refund Functions ──────────────────────────────────────────

export async function requestRefund(
  caller: string,
  paymentId: number,
  amount: number,
  asset: string,
  reason: string,
  reasonCode: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(paymentId, { type: "u64" }),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(asset, { type: "address" }),
    nativeToScVal(reason, { type: "string" }),
    nativeToScVal(reasonCode, { type: "u32" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "request_refund", args);
}

export async function approveRefund(
  caller: string,
  refundId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(refundId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "approve_refund", args);
}

export async function processRefund(
  caller: string,
  refundId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(refundId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "process_refund", args);
}

// ── Notification Hook Functions ───────────────────────────────

export async function registerHook(
  subscriber: string,
  eventType: string,
  webhookUrl: string,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(subscriber, { type: "address" }),
    nativeToScVal(eventType, { type: "string" }),
    nativeToScVal(webhookUrl, { type: "string" }),
  ];
  return signAndSubmit(subscriber, CONTRACT_ID, "register_hook", args);
}

export async function unregisterHook(
  caller: string,
  hookId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(hookId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "unregister_hook", args);
}

// ── RBAC Functions ────────────────────────────────────────────

/** Role enum values matching the Soroban contract (Admin=0, Operator=1, Auditor=2). */
export const Role = {
  Admin: 0,
  Operator: 1,
  Auditor: 2,
} as const;

export type RoleValue = (typeof Role)[keyof typeof Role];

export async function grantRole(
  caller: string,
  grantee: string,
  role: RoleValue,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(grantee, { type: "address" }),
    nativeToScVal(role, { type: "u32" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "grant_role", args);
}

export async function revokeRole(
  caller: string,
  grantee: string,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(grantee, { type: "address" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "revoke_role", args);
}

/**
 * Simulate reading a role (read-only).
 * Note: Uses contract simulation without args; for arg-based queries, use
 * the full invokeContractFunction flow or call via API route.
 */
export async function getRole(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_role", sourcePublicKey);
}

// ── Fee Config Functions ──────────────────────────────────────

export async function setFeeConfig(
  caller: string,
  paymentFeeBps: number,
  escrowFeeBps: number,
  streamFeeBps: number,
  batchBaseFee: number,
  batchPerItemFee: number,
  enabled: boolean,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(paymentFeeBps, { type: "u32" }),
    nativeToScVal(escrowFeeBps, { type: "u32" }),
    nativeToScVal(streamFeeBps, { type: "u32" }),
    nativeToScVal(batchBaseFee, { type: "i128" }),
    nativeToScVal(batchPerItemFee, { type: "i128" }),
    nativeToScVal(enabled, { type: "bool" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "set_fee_config", args);
}

/**
 * Simulate reading current fee config (read-only).
 */
export async function getFeeConfig(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_fee_config", sourcePublicKey);
}

/**
 * Simulate reading fee config version history (read-only).
 */
export async function getFeeConfigHistory(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_fee_config_history", sourcePublicKey);
}

/**
 * Simulate reading a specific fee config version (read-only).
 * Note: Uses contract simulation without args; for version-specific queries,
 * use the full invokeContractFunction flow or call via API route.
 */
export async function getFeeConfigAtVersion(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_fee_config_at_version", sourcePublicKey);
}

export async function setFeeCollector(
  caller: string,
  collector: string,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(collector, { type: "address" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "set_fee_collector", args);
}

/**
 * Simulate reading fee collector address (read-only).
 */
export async function getFeeCollector(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_fee_collector", sourcePublicKey);
}

// ── Timelocked Action Functions ───────────────────────────────

export async function proposeTimelockedAction(
  caller: string,
  actionType: string,
  target: string,
  data: string,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(actionType, { type: "string" }),
    nativeToScVal(target, { type: "string" }),
    nativeToScVal(data, { type: "string" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "propose_timelocked_action", args);
}

export async function executeTimelockedAction(
  sourcePublicKey: string,
  actionId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(actionId, { type: "u64" }),
  ];
  return signAndSubmit(sourcePublicKey, CONTRACT_ID, "execute_timelocked_action", args);
}

export async function cancelTimelockedAction(
  caller: string,
  actionId: number,
): Promise<ContractCallResult> {
  const args: xdr.ScVal[] = [
    nativeToScVal(caller, { type: "address" }),
    nativeToScVal(actionId, { type: "u64" }),
  ];
  return signAndSubmit(caller, CONTRACT_ID, "cancel_timelocked_action", args);
}

// ── Policy Version History Functions ──────────────────────────

/**
 * Simulate reading multisig config version history (read-only).
 */
export async function getMultisigConfigHistory(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_multisig_config_history", sourcePublicKey);
}

/**
 * Simulate reading fee config version history (read-only). Alias for getFeeConfigHistory.
 */
export async function getPolicyFeeConfigHistory(sourcePublicKey: string) {
  return simulateContractCall(CONTRACT_ID, "get_fee_config_history", sourcePublicKey);
}
