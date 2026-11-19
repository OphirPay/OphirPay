// SPDX-License-Identifier: MIT

/**
 * Payment-stream vesting math (#1377).
 *
 * This mirrors `compute_vested` in `contracts/ophirpay/src/helpers.rs`
 * exactly:
 *
 *   - nothing vests at or before `start_time`;
 *   - everything vests at or after `end_time`;
 *   - in between, `floor(total * elapsed / duration)`.
 *
 * The contract additionally guards against a 128-bit multiplication overflow
 * with a decomposition that is mathematically equal to the same floor
 * division. JavaScript `BigInt` multiplication cannot overflow, so the direct
 * formula is exact for every value the contract can store — displayed
 * claimable balances therefore agree with what `claim_stream` will pay.
 *
 * Keeping this in one module is deliberate: the list page, the detail chart,
 * and the future-date simulator must not each re-derive rounding differently.
 */

export interface VestingState {
  total: bigint;
  claimed: bigint;
  start: bigint;
  end: bigint;
  /** Current (or simulated) ledger time, in Unix seconds. */
  now: bigint;
  /** A cancelled stream stops accruing and pays out only what had vested. */
  cancelled?: boolean;
}

/**
 * Amount vested at `now`, in the stream's base units (stroops for XLM).
 *
 * A cancelled stream is treated as fully settled at its claimed amount, which
 * matches the contract: `cancel_stream` sets `claimed_amount = vested` and
 * payouts stop.
 */
export function computeVested(
  total: bigint,
  start: bigint,
  end: bigint,
  now: bigint
): bigint {
  if (total <= BigInt(0)) return BigInt(0);
  if (now >= end) return total;
  if (now <= start) return BigInt(0);

  const duration = end - start;
  if (duration <= BigInt(0)) return total;

  return (total * (now - start)) / duration;
}

/** Vested but not yet claimed — what `claim_stream` would transfer now. */
export function computeClaimable(state: VestingState): bigint {
  if (state.cancelled) return BigInt(0);

  const vested = computeVested(state.total, state.start, state.end, state.now);
  const remaining = vested - state.claimed;
  return remaining > BigInt(0) ? remaining : BigInt(0);
}

/** Percentage vested (0–100, two decimals) for progress displays. */
export function vestingPercent(vested: bigint, total: bigint): number {
  if (total <= BigInt(0)) return 0;
  const clamped = vested < BigInt(0) ? BigInt(0) : vested > total ? total : vested;
  return Number((clamped * BigInt(10_000)) / total) / 100;
}

/**
 * State as of an arbitrary future timestamp, for the claim simulator.
 *
 * `claimed` stays fixed: the simulator answers "what would be claimable if I
 * did nothing until then", not "what if I claim repeatedly". Future dates
 * beyond the stream end clamp to the full amount.
 */
export function simulateAt(state: VestingState, futureTime: bigint): VestingState {
  const at = futureTime < state.now ? state.now : futureTime;
  return { ...state, now: at, cancelled: false };
}
