// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/api-cache", () => ({
  cachedFetch: vi.fn((key: string, fetcher: () => Promise<unknown>) => fetcher()),
  cacheDelete: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: vi.fn(),
}));

vi.mock("@/lib/contract-advanced", () => ({
  createGovernanceProposal: vi.fn(),
  voteOnProposal: vi.fn(),
  executeGovernanceProposal: vi.fn(),
}));

import * as authSession from "@/lib/auth-session";
import * as csrf from "@/lib/csrf";
import * as contracts from "@/lib/contracts";
import * as contractAdvanced from "@/lib/contract-advanced";
import { GET as getProposals, POST as postProposals } from "@/app/api/governance/proposals/route";
import { POST as postVote } from "@/app/api/governance/vote/route";
import { POST as postExecuteGov } from "@/app/api/governance/execute/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrf.verifyCsrf).mockReturnValue(null);
  });

  describe("GET /api/governance/proposals", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getProposals(new Request("http://localhost/api/governance/proposals"));
      expect(res.status).toBe(401);
    });

    it("returns empty list when proposal count simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getProposals(new Request("http://localhost/api/governance/proposals"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    it("returns empty list when total count is 0", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 0,
      } as never);

      const res = await getProposals(new Request("http://localhost/api/governance/proposals"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    it("enumerates proposals and marks truncated:true when total exceeds 100", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: 105,
        } as never)
        .mockResolvedValue({
          status: "SUCCESS",
          returnValue: { id: 100, title: "Proposal" },
        } as never);

      const res = await getProposals(new Request("http://localhost/api/governance/proposals"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.truncated).toBe(true);
      expect(data.data.total).toBe(105);
      expect(data.data.items.length).toBeGreaterThan(0);
    });
  });

  describe("POST /api/governance/proposals", () => {
    it("returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await postProposals(
        new Request("http://localhost/api/governance/proposals", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postProposals(
        new Request("http://localhost/api/governance/proposals", { method: "POST" })
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 on validation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postProposals(
        new Request("http://localhost/api/governance/proposals", {
          method: "POST",
          body: JSON.stringify({ title: "" }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 on contract error", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.createGovernanceProposal).mockResolvedValueOnce({
        success: false,
        error: "Insufficient deposit",
      });

      const res = await postProposals(
        new Request("http://localhost/api/governance/proposals", {
          method: "POST",
          body: JSON.stringify({
            proposer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            title: "Upgrade Contract",
          }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("creates proposal successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.createGovernanceProposal).mockResolvedValueOnce({
        success: true,
        txHash: "tx_gov_prop",
        data: 8,
      });

      const res = await postProposals(
        new Request("http://localhost/api/governance/proposals", {
          method: "POST",
          body: JSON.stringify({
            proposer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            title: "Upgrade Contract",
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.proposalId).toBe(8);
    });
  });

  describe("POST /api/governance/vote", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postVote(
        new Request("http://localhost/api/governance/vote", { method: "POST" })
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 on CSRF failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await postVote(
        new Request("http://localhost/api/governance/vote", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("returns 400 on contract error", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.voteOnProposal).mockResolvedValueOnce({
        success: false,
        error: "Already voted",
      });

      const res = await postVote(
        new Request("http://localhost/api/governance/vote", {
          method: "POST",
          body: JSON.stringify({
            voter: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            proposalId: 8,
            support: true,
          }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("casts vote successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.voteOnProposal).mockResolvedValueOnce({
        success: true,
        txHash: "tx_vote_1",
      });

      const res = await postVote(
        new Request("http://localhost/api/governance/vote", {
          method: "POST",
          body: JSON.stringify({
            voter: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            proposalId: 8,
            support: true,
          }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.voted).toBe(true);
    });
  });

  describe("POST /api/governance/execute", () => {
    it("returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF invalid" } }), {
          status: 403,
        })
      );
      const res = await postExecuteGov(
        new Request("http://localhost/api/governance/execute", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postExecuteGov(
        new Request("http://localhost/api/governance/execute", { method: "POST" })
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 on contract execution failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.executeGovernanceProposal).mockResolvedValueOnce({
        success: false,
        error: "Voting period active",
      });

      const res = await postExecuteGov(
        new Request("http://localhost/api/governance/execute", {
          method: "POST",
          body: JSON.stringify({ proposalId: 8 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("executes proposal successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.executeGovernanceProposal).mockResolvedValueOnce({
        success: true,
        txHash: "tx_gov_exec_1",
      });

      const res = await postExecuteGov(
        new Request("http://localhost/api/governance/execute", {
          method: "POST",
          body: JSON.stringify({ proposalId: 8 }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.executed).toBe(true);
    });
  });
});
