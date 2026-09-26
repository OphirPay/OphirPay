// SPDX-License-Identifier: MIT

/**
 * Payment Stream domain types and linear vesting calculation utilities.
 * 
 * Parity Guarantee:
 * The integer arithmetic in `computeVested` and `computeClaimable` strictly mirrors
 * the Soroban contract implementation in `contracts/ophirpay/src/lib.rs` (lines 999-1016 & 3381-3388)
 * to ensure client calculations never drift from on-chain state.
 */

export interface StreamRecord {
  id: number;
  creator: string;
  recipient: string;
  totalAmount: string; // Stored in stroops (1 XLM = 10^7 stroops) or integer units
  claimedAmount: string; // Stored in stroops
  asset: string;
  startTime: number; // Unix timestamp in seconds
  endTime: number; // Unix timestamp in seconds
  cancelled: boolean;
  metadata: string;
}

export type StreamStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";

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
 * Normalizes raw contract RPC objects into typed `StreamRecord`.
 * Handles both snake_case (Soroban native) and camelCase properties.
 */
export function normalizeStream(raw: unknown): StreamRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid stream object: expected non-null object");
  }

  const rec = raw as Record<string, unknown>;

  const id = Number(rec.id ?? 0);
  const creator = String(rec.creator ?? "");
  const recipient = String(rec.recipient ?? "");
  const totalAmount = String(rec.total_amount ?? rec.totalAmount ?? "0");
  const claimedAmount = String(rec.claimed_amount ?? rec.claimedAmount ?? "0");
  const asset = String(rec.asset ?? "native");
  const startTime = Number(rec.start_time ?? rec.startTime ?? 0);
  const endTime = Number(rec.end_time ?? rec.endTime ?? 0);
  const cancelled = Boolean(rec.cancelled);
  const metadata = String(rec.metadata ?? "");

  return {
    id,
    creator,
    recipient,
    totalAmount,
    claimedAmount,
    asset,
    startTime,
    endTime,
    cancelled,
    metadata,
  };
}

/**
 * Calculate linearly vested amount with overflow protection.
 * Exact equivalent of `compute_vested` in `contracts/ophirpay/src/lib.rs`.
 */
export function computeVested(
  totalAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number
): bigint {
  const total = BigInt(totalAmount);
  if (total <= BigInt(0)) return BigInt(0);

  if (nowSeconds >= endTime) {
    return total;
  }
  if (nowSeconds <= startTime) {
    return BigInt(0);
  }

  const elapsed = BigInt(nowSeconds - startTime);
  const totalDuration = BigInt(endTime - startTime);

  if (totalDuration === BigInt(0)) {
    return total;
  }

  // Integer multiplication and division matching Soroban's i128 checked arithmetic
  const product = total * elapsed;
  return product / totalDuration;
}

/**
 * Calculate amount currently claimable by recipient.
 * Mirrors `claim_stream` logic:
 *   let claimable = vested - stream.claimed_amount;
 * Note: If stream is cancelled, claimable is BigInt(0) because `claim_stream` rejects cancelled streams.
 */
export function computeClaimable(
  totalAmount: bigint | number | string,
  claimedAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number,
  cancelled?: boolean
): bigint {
  if (cancelled) {
    return BigInt(0);
  }

  const vested = computeVested(totalAmount, startTime, endTime, nowSeconds);
  const claimed = BigInt(claimedAmount);

  const claimable = vested - claimed;
  return claimable > BigInt(0) ? claimable : BigInt(0);
}

/**
 * Calculate remaining unvested tokens returned to creator if cancelled.
 * Mirrors `cancel_stream` logic:
 *   let unvested = stream.total_amount.saturating_sub(vested);
 */
export function computeUnvested(
  totalAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number
): bigint {
  const total = BigInt(totalAmount);
  const vested = computeVested(totalAmount, startTime, endTime, nowSeconds);
  const unvested = total - vested;
  return unvested > BigInt(0) ? unvested : BigInt(0);
}

/**
 * Calculate remaining unclaimed tokens (total - claimed).
 */
export function computeRemaining(
  totalAmount: bigint | number | string,
  claimedAmount: bigint | number | string
): bigint {
  const total = BigInt(totalAmount);
  const claimed = BigInt(claimedAmount);
  const remaining = total - claimed;
  return remaining > BigInt(0) ? remaining : BigInt(0);
}

/**
 * Returns progress percentage [0, 100] of the vesting schedule.
 */
export function computeVestingProgress(
  startTime: number,
  endTime: number,
  nowSeconds: number
): number {
  if (nowSeconds <= startTime) return 0;
  if (nowSeconds >= endTime) return 100;
  const duration = endTime - startTime;
  if (duration <= 0) return 100;
  const elapsed = nowSeconds - startTime;
  const pct = (elapsed / duration) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

/**
 * Determines current lifecycle status of a stream.
 */
export function getStreamStatus(
  stream: Pick<StreamRecord, "cancelled" | "startTime" | "endTime" | "totalAmount" | "claimedAmount">,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): StreamStatus {
  if (stream.cancelled) return "CANCELLED";

  const total = BigInt(stream.totalAmount);
  const claimed = BigInt(stream.claimedAmount);
  if (total > BigInt(0) && claimed >= total) return "COMPLETED";

  if (nowSeconds < stream.startTime) return "PENDING";
  if (nowSeconds >= stream.endTime) {
    return claimed >= total ? "COMPLETED" : "ACTIVE";
  }

  return "ACTIVE";
}
