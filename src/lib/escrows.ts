// SPDX-License-Identifier: MIT

/**
 * Escrow domain models, lifecycle state machine, and normalization helpers.
 * 
 * Strict parity with `contracts/ophirpay/src/lib.rs` (lines 135-146, 3020-3272)
 */

export interface EscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter: string | null;
  amount: string; // Amount in stroops (1 XLM = 10^7 stroops)
  asset: string;
  deadline: number; // Unix timestamp in seconds
  released: boolean;
  claimed: boolean;
  metadata: string;
}

export type EscrowStatus = "LOCKED" | "DUE_FOR_CLAIM" | "RELEASED" | "CLAIMED";

export type EscrowRole = "depositor" | "beneficiary" | "arbiter" | "observer";

export const STROOPS_PER_XLM = BigInt(10_000_000);

/**
 * Convert stroop integer (10^-7 XLM) to a human-readable decimal number.
 */
export function stroopsToDecimal(stroops: bigint | string | number): number {
  try {
    const b = BigInt(stroops);
    return Number(b) / 10_000_000;
  } catch {
    return 0;
  }
}

/**
 * Convert human-readable decimal number to stroop BigInt.
 */
export function decimalToStroops(decimal: number | string): bigint {
  const num = typeof decimal === "string" ? parseFloat(decimal) : decimal;
  if (isNaN(num) || num <= 0) return BigInt(0);
  return BigInt(Math.round(num * 10_000_000));
}

/**
 * Formats a stroop amount into decimal string with specified fraction digits.
 */
export function formatStroopAmount(stroops: bigint | string | number, decimals: number = 4): string {
  const val = stroopsToDecimal(stroops);
  return val.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Normalizes raw contract RPC objects into typed `EscrowRecord`.
 * Handles both snake_case (Soroban native) and camelCase properties.
 */
export function normalizeEscrow(raw: unknown): EscrowRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid escrow object: expected non-null object");
  }

  const rec = raw as Record<string, unknown>;

  const id = Number(rec.id ?? 0);
  const depositor = String(rec.depositor ?? "");
  const beneficiary = String(rec.beneficiary ?? "");
  
  let arbiter: string | null = null;
  if (rec.arbiter && typeof rec.arbiter === "string" && rec.arbiter.startsWith("G")) {
    arbiter = rec.arbiter;
  }

  const amount = String(rec.amount ?? "0");
  const asset = String(rec.asset ?? "native");
  const deadline = Number(rec.deadline ?? 0);
  const released = Boolean(rec.released);
  const claimed = Boolean(rec.claimed);
  const metadata = String(rec.metadata ?? "");

  return {
    id,
    depositor,
    beneficiary,
    arbiter,
    amount,
    asset,
    deadline,
    released,
    claimed,
    metadata,
  };
}

/**
 * Evaluates the deterministic state of an escrow based on flags and deadlines.
 * State machine:
 *   - LOCKED: !released && !claimed && now < deadline
 *   - DUE_FOR_CLAIM: !released && !claimed && now >= deadline (beneficiary can claim)
 *   - RELEASED: released (unlocked by depositor or arbiter)
 *   - CLAIMED: claimed (settled by beneficiary)
 */
export function getEscrowStatus(
  escrow: Pick<EscrowRecord, "released" | "claimed" | "deadline">,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): EscrowStatus {
  if (escrow.released) return "RELEASED";
  if (escrow.claimed) return "CLAIMED";
  if (nowSeconds >= escrow.deadline) return "DUE_FOR_CLAIM";
  return "LOCKED";
}

/**
 * Identifies the connected wallet's authorization role relative to an escrow.
 */
export function getEscrowRole(
  escrow: EscrowRecord,
  userAddress?: string | null
): EscrowRole {
  if (!userAddress) return "observer";
  const addr = userAddress.toLowerCase();
  if (escrow.depositor.toLowerCase() === addr) return "depositor";
  if (escrow.beneficiary.toLowerCase() === addr) return "beneficiary";
  if (escrow.arbiter && escrow.arbiter.toLowerCase() === addr) return "arbiter";
  return "observer";
}
