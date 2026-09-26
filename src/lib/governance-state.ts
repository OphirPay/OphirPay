// SPDX-License-Identifier: MIT

/**
 * Proposal lifecycle derivation (issue #808).
 *
 * The contract exposes no "cancelled" flag (only a ProposalCancelled error
 * code) and quorum is defined as basis points of token supply, which has no
 * on-chain read in scope — so passed/failed follows the majority of votes
 * cast, matching the proposals list, while quorum_bps is shown as
 * informational config. Cancelled is therefore not derivable and intentionally
 * absent here.
 */

export type ProposalState = "pending" | "active" | "passed" | "failed" | "executed";

export interface ProposalLifecycle {
  voting_ends_at: number | null;
  executed: boolean;
  yes_votes: number;
  no_votes: number;
}

export function deriveProposalState(
  p: ProposalLifecycle,
  nowMs: number = Date.now(),
): ProposalState {
  if (p.executed) return "executed";
  if (!p.voting_ends_at) return "pending";
  if (p.voting_ends_at * 1000 > nowMs) return "active";
  return p.yes_votes > p.no_votes ? "passed" : "failed";
}

/** Executable when voting produced a majority and it has not run yet. */
export function canExecuteProposal(p: ProposalLifecycle, nowMs: number = Date.now()): boolean {
  return deriveProposalState(p, nowMs) === "passed" && !p.executed;
}

/** Seconds remaining in the voting window, 0 when closed or unscheduled. */
export function votingSecondsLeft(
  p: Pick<ProposalLifecycle, "voting_ends_at">,
  nowMs: number = Date.now(),
): number {
  if (!p.voting_ends_at) return 0;
  return Math.max(0, Math.floor(p.voting_ends_at - nowMs / 1000));
}
