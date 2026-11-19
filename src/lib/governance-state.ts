// SPDX-License-Identifier: MIT

export type GovernanceProposalState = "pending" | "active" | "passed" | "failed" | "executed" | "cancelled";

export interface GovernanceProposalStateInput {
  created_at: number;
  voting_ends_at: number;
  executed: boolean;
  yes_votes: number;
  no_votes: number;
  cancelled?: boolean;
}

/** Mirrors the proposal lifecycle for display; execution eligibility is checked separately. */
export function getGovernanceProposalState(
  proposal: GovernanceProposalStateInput,
  now: number,
): GovernanceProposalState {
  if (proposal.cancelled) return "cancelled";
  if (proposal.executed) return "executed";
  if (now < proposal.created_at) return "pending";
  if (now <= proposal.voting_ends_at) return "active";
  return proposal.yes_votes > proposal.no_votes ? "passed" : "failed";
}