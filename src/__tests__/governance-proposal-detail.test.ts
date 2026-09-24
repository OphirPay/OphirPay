// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getProposalStatus,
  canExecuteProposal,
  formatDuration,
  recordProposalVote,
  getProposalVotes,
  DEFAULT_GOVERNANCE_CONFIG,
  type Proposal,
} from "@/lib/governance";
import { GET as getProposalDetail } from "@/app/api/governance/proposals/[id]/route";
import * as contractsLib from "@/lib/contracts";
import * as authSessionLib from "@/lib/auth-session";

describe("Governance State Machine & Logic", () => {
  const baseProposal: Proposal = {
    id: 1,
    title: "Upgrade Contract",
    description: "Upgrade protocol logic",
    action_type: "upgrade",
    target: "set_code",
    data: "deadbeef",
    yes_votes: 10,
    no_votes: 3,
    voting_ends_at: 1000,
    executed: false,
    created_at: 500,
    proposer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    deposit_asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    deposit_amount: "10000000",
  };

  describe("getProposalStatus", () => {
    it("returns 'cancelled' when proposal is cancelled", () => {
      const status = getProposalStatus({ ...baseProposal, cancelled: true }, {}, 800);
      expect(status).toBe("cancelled");
    });

    it("returns 'executed' when proposal has been executed on-chain", () => {
      const status = getProposalStatus({ ...baseProposal, executed: true }, {}, 1200);
      expect(status).toBe("executed");
    });

    it("returns 'pending' when now is before created_at", () => {
      const status = getProposalStatus(baseProposal, {}, 400);
      expect(status).toBe("pending");
    });

    it("returns 'active' when voting period is currently open", () => {
      const status = getProposalStatus(baseProposal, {}, 800);
      expect(status).toBe("active");
    });

    it("returns 'passed' when voting period ended and yes_votes > no_votes", () => {
      const status = getProposalStatus(
        { ...baseProposal, yes_votes: 10, no_votes: 5, voting_ends_at: 1000 },
        {},
        1200
      );
      expect(status).toBe("passed");
    });

    it("returns 'failed' when voting period ended and yes_votes <= no_votes", () => {
      const status = getProposalStatus(
        { ...baseProposal, yes_votes: 4, no_votes: 8, voting_ends_at: 1000 },
        {},
        1200
      );
      expect(status).toBe("failed");
    });
  });

  describe("canExecuteProposal", () => {
    it("rejects execution if voting period is still active", () => {
      const res = canExecuteProposal(baseProposal, 800);
      expect(res.canExecute).toBe(false);
      expect(res.reason).toContain("Voting period is still active");
    });

    it("rejects execution if proposal has already been executed", () => {
      const res = canExecuteProposal({ ...baseProposal, executed: true }, 1200);
      expect(res.canExecute).toBe(false);
      expect(res.reason).toContain("already been executed");
    });

    it("rejects execution if proposal was cancelled", () => {
      const res = canExecuteProposal({ ...baseProposal, cancelled: true }, 1200);
      expect(res.canExecute).toBe(false);
      expect(res.reason).toContain("cancelled");
    });

    it("rejects execution if proposal was defeated", () => {
      const res = canExecuteProposal(
        { ...baseProposal, yes_votes: 2, no_votes: 5 },
        1200
      );
      expect(res.canExecute).toBe(false);
      expect(res.reason).toContain("defeated");
    });

    it("allows execution when voting has concluded and yes_votes > no_votes", () => {
      const res = canExecuteProposal(
        { ...baseProposal, yes_votes: 12, no_votes: 4 },
        1200
      );
      expect(res.canExecute).toBe(true);
      expect(res.reason).toBeUndefined();
    });
  });

  describe("formatDuration", () => {
    it("formats seconds into readable days, hours, and minutes", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(45)).toBe("45s");
      expect(formatDuration(3600)).toBe("1h");
      expect(formatDuration(3665)).toBe("1h 1m");
      expect(formatDuration(86400 * 3 + 3600 * 4)).toBe("3d 4h");
    });
  });

  describe("Vote Registry", () => {
    it("records and retrieves individual votes with 1-address-1-vote uniqueness", () => {
      const voterA = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      const voterB = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

      recordProposalVote({
        proposalId: 99,
        voter: voterA,
        support: true,
        timestamp: 1000,
        txHash: "tx_111",
      });

      recordProposalVote({
        proposalId: 99,
        voter: voterB,
        support: false,
        timestamp: 1020,
        txHash: "tx_222",
      });

      // Duplicate vote from voterA updates their vote (1-address-1-vote)
      recordProposalVote({
        proposalId: 99,
        voter: voterA,
        support: false,
        timestamp: 1040,
        txHash: "tx_333",
      });

      const votes = getProposalVotes(99);
      expect(votes).toHaveLength(2);
      const voterARecord = votes.find((v) => v.voter === voterA);
      expect(voterARecord?.support).toBe(false);
      expect(voterARecord?.txHash).toBe("tx_333");
    });

    it("synthesizes reconciled records if contract has votes without local log", () => {
      const syntheticVotes = getProposalVotes(500, {
        yes_votes: 2,
        no_votes: 1,
        created_at: 100,
      });
      expect(syntheticVotes).toHaveLength(3);
      expect(syntheticVotes.filter((v) => v.support)).toHaveLength(2);
      expect(syntheticVotes.filter((v) => !v.support)).toHaveLength(1);
    });
  });
});

describe("GET /api/governance/proposals/[id] Endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.spyOn(authSessionLib, "getAuthContext").mockResolvedValue(null);
    const req = new Request("http://localhost/api/governance/proposals/1");
    const res = await getProposalDetail(req, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid numeric ID", async () => {
    vi.spyOn(authSessionLib, "getAuthContext").mockResolvedValue({
      type: "wallet",
      publicKey: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    const req = new Request("http://localhost/api/governance/proposals/not-a-number");
    const res = await getProposalDetail(req, {
      params: Promise.resolve({ id: "not-a-number" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when proposal simulation returns no data", async () => {
    vi.spyOn(authSessionLib, "getAuthContext").mockResolvedValue({
      type: "wallet",
      publicKey: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    vi.spyOn(contractsLib, "simulateContractCall").mockResolvedValue({
      status: "SIMULATION_FAILED",
      events: [],
    });

    const req = new Request("http://localhost/api/governance/proposals/999");
    const res = await getProposalDetail(req, {
      params: Promise.resolve({ id: "999" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with complete proposal stats, quorum, and execution state when found", async () => {
    vi.spyOn(authSessionLib, "getAuthContext").mockResolvedValue({
      type: "wallet",
      publicKey: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });

    const now = Math.floor(Date.now() / 1000);
    const mockProposalData = {
      id: 42,
      title: "Set Platform Fee",
      description: "Update platform fee to 15 bps",
      action_type: "set_fee_config",
      target: "configure_fees",
      data: "0000000f",
      yes_votes: 15,
      no_votes: 2,
      voting_ends_at: now - 3600, // concluded 1 hour ago
      executed: false,
      created_at: now - 86400 * 7,
      proposer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      deposit_asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      deposit_amount: "50000000",
    };

    const mockConfigData = {
      min_proposal_deposit: "10000000",
      voting_period: 604800,
      quorum_bps: 5100,
      enabled: true,
    };

    vi.spyOn(contractsLib, "simulateContractCall").mockImplementation(
      async (_contractId, fnName) => {
        if (fnName === "get_proposal") {
          return { status: "SUCCESS", returnValue: mockProposalData, events: [] };
        }
        if (fnName === "get_governance_config") {
          return { status: "SUCCESS", returnValue: mockConfigData, events: [] };
        }
        return { status: "SUCCESS", returnValue: null, events: [] };
      }
    );

    const req = new Request("http://localhost/api/governance/proposals/42");
    const res = await getProposalDetail(req, {
      params: Promise.resolve({ id: "42" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const detail = json.data;
    expect(detail.id).toBe(42);
    expect(detail.title).toBe("Set Platform Fee");
    expect(detail.status).toBe("passed");
    expect(detail.canExecute).toBe(true);
    expect(detail.quorum.targetBps).toBe(5100);
    expect(detail.quorum.thresholdMet).toBe(true);
    expect(detail.votes).toBeDefined();
  });
});
