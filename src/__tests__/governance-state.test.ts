// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { getGovernanceProposalState, type GovernanceProposalStateInput } from "@/lib/governance-state";

const proposal: GovernanceProposalStateInput = {
  created_at: 100,
  voting_ends_at: 200,
  executed: false,
  yes_votes: 3,
  no_votes: 1,
};

describe("governance proposal state machine", () => {
  it("distinguishes pending and active voting windows", () => {
    expect(getGovernanceProposalState(proposal, 99)).toBe("pending");
    expect(getGovernanceProposalState(proposal, 150)).toBe("active");
  });

  it("distinguishes passed and failed proposals after voting ends", () => {
    expect(getGovernanceProposalState(proposal, 201)).toBe("passed");
    expect(getGovernanceProposalState({ ...proposal, yes_votes: 1, no_votes: 3 }, 201)).toBe("failed");
  });

  it("prioritizes cancelled and executed terminal states", () => {
    expect(getGovernanceProposalState({ ...proposal, cancelled: true, executed: true }, 250)).toBe("cancelled");
    expect(getGovernanceProposalState({ ...proposal, executed: true }, 250)).toBe("executed");
  });
});