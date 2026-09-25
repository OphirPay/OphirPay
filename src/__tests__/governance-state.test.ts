// SPDX-License-Identifier: MIT

// Proposal lifecycle derivation for the governance detail view (issue #808).

import { describe, it, expect } from "vitest";
import {
  deriveProposalState,
  canExecuteProposal,
  votingSecondsLeft,
} from "@/lib/governance-state";

const NOW = 1_700_000_000_000;

describe("deriveProposalState", () => {
  it("reports executed regardless of timing", () => {
    expect(
      deriveProposalState({ voting_ends_at: 1, executed: true, yes_votes: 0, no_votes: 99 }, NOW)
    ).toBe("executed");
  });

  it("reports pending when no voting window is scheduled", () => {
    expect(
      deriveProposalState({ voting_ends_at: null, executed: false, yes_votes: 0, no_votes: 0 }, NOW)
    ).toBe("pending");
  });

  it("reports active while the window is open", () => {
    expect(
      deriveProposalState(
        { voting_ends_at: NOW / 1000 + 3600, executed: false, yes_votes: 1, no_votes: 0 },
        NOW
      )
    ).toBe("active");
  });

  it("reports passed on majority after close", () => {
    expect(
      deriveProposalState(
        { voting_ends_at: NOW / 1000 - 10, executed: false, yes_votes: 5, no_votes: 2 },
        NOW
      )
    ).toBe("passed");
  });

  it("reports failed without majority after close (ties fail)", () => {
    expect(
      deriveProposalState(
        { voting_ends_at: NOW / 1000 - 10, executed: false, yes_votes: 2, no_votes: 2 },
        NOW
      )
    ).toBe("failed");
  });
});

describe("canExecuteProposal", () => {
  it("is true only for passed, unexecuted proposals", () => {
    const passed = { voting_ends_at: NOW / 1000 - 10, executed: false, yes_votes: 5, no_votes: 2 };
    expect(canExecuteProposal(passed, NOW)).toBe(true);
    expect(canExecuteProposal({ ...passed, executed: true }, NOW)).toBe(false);
    expect(
      canExecuteProposal({ ...passed, yes_votes: 1, no_votes: 9 }, NOW)
    ).toBe(false);
  });
});

describe("votingSecondsLeft", () => {
  it("counts down while open and floors at zero", () => {
    expect(votingSecondsLeft({ voting_ends_at: NOW / 1000 + 90 }, NOW)).toBe(90);
    expect(votingSecondsLeft({ voting_ends_at: NOW / 1000 - 5 }, NOW)).toBe(0);
    expect(votingSecondsLeft({ voting_ends_at: null }, NOW)).toBe(0);
  });
});
