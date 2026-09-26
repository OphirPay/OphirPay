// SPDX-License-Identifier: MIT

/**
 * Escrow role gating for the escrows UI (issue #798).
 *
 * Role truth lives on-chain (release: contract owner, claim: beneficiary
 * past deadline, arbiter release: arbiter). The client mirrors it so actions
 * only render for the authorized wallet; unauthorized attempts still surface
 * the contract error via toast.
 */

export interface EscrowRecord {
  id: number;
  depositor: string;
  beneficiary: string;
  arbiter?: string | null;
  amount: number | string;
  asset: string;
  /** Unlock timestamp in ledger seconds. */
  deadline: number;
  released: boolean;
  claimed: boolean;
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Terminal states need no further action. */
export function isEscrowSettled(e: Pick<EscrowRecord, "released" | "claimed">): boolean {
  return e.released || e.claimed;
}

/** Seconds until the beneficiary can claim; 0 once unlocked. */
export function secondsUntilUnlock(
  e: Pick<EscrowRecord, "deadline">,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  return Math.max(0, Math.floor(e.deadline - nowSeconds));
}

/** Beneficiary action, only past the deadline on an unsettled escrow. */
export function canClaim(
  e: EscrowRecord,
  walletAddress?: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!walletAddress || isEscrowSettled(e)) return false;
  return sameAddress(e.beneficiary, walletAddress) && secondsUntilUnlock(e, nowSeconds) === 0;
}

/** Arbiter action on an unsettled escrow with an arbiter assigned. */
export function canArbiterRelease(
  e: EscrowRecord,
  walletAddress?: string | null,
): boolean {
  if (!walletAddress || isEscrowSettled(e)) return false;
  return sameAddress(e.arbiter, walletAddress);
}
