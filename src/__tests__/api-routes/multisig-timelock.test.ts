// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: vi.fn(),
}));

vi.mock("@/lib/contract-advanced", () => ({
  setMultisigConfig: vi.fn(),
  approveMultisigPayment: vi.fn(),
  executeApprovedPayment: vi.fn(),
  proposeMultisigPayment: vi.fn(),
}));

import * as authSession from "@/lib/auth-session";
import * as csrf from "@/lib/csrf";
import * as contracts from "@/lib/contracts";
import * as contractAdvanced from "@/lib/contract-advanced";
import { GET as getMultisig, POST as postMultisig } from "@/app/api/multisig/route";
import { POST as postApprove } from "@/app/api/multisig/approve/route";
import { POST as postExecute } from "@/app/api/multisig/execute/route";
import { POST as postPropose } from "@/app/api/multisig/propose/route";
import { GET as getMultisigRequests } from "@/app/api/multisig/requests/route";
import { GET as getTimelock } from "@/app/api/timelock/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Multisig & Timelock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrf.verifyCsrf).mockReturnValue(null);
  });

  describe("/api/multisig", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getMultisig(new Request("http://localhost/api/multisig"));
      expect(res.status).toBe(401);
    });

    it("GET returns fallback config when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getMultisig(new Request("http://localhost/api/multisig"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.source).toBe("contract_unavailable");
    });

    it("GET returns active multisig config on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { threshold: 2, signers: ["G1", "G2"], enabled: true },
      } as never);

      const res = await getMultisig(new Request("http://localhost/api/multisig"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.threshold).toBe(2);
    });

    it("POST returns 400 when caller is missing", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postMultisig(
        new Request("http://localhost/api/multisig", {
          method: "POST",
          body: JSON.stringify({ threshold: 2 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST returns 400 when contract call fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.setMultisigConfig).mockResolvedValueOnce({
        success: false,
        error: "Caller is not admin",
      });

      const res = await postMultisig(
        new Request("http://localhost/api/multisig", {
          method: "POST",
          body: JSON.stringify({ caller: "G_ADMIN", threshold: 2, signers: ["G1"], enabled: true }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST updates multisig config successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.setMultisigConfig).mockResolvedValueOnce({
        success: true,
        txHash: "tx_multisig_config",
      });

      const res = await postMultisig(
        new Request("http://localhost/api/multisig", {
          method: "POST",
          body: JSON.stringify({
            caller: "G_ADMIN",
            threshold: 2,
            signers: ["G1", "G2"],
            enabled: true,
          }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.txHash).toBe("tx_multisig_config");
    });
  });

  describe("POST /api/multisig/approve", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postApprove(
        new Request("http://localhost/api/multisig/approve", { method: "POST" })
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
      const res = await postApprove(
        new Request("http://localhost/api/multisig/approve", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("returns 400 on validation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postApprove(
        new Request("http://localhost/api/multisig/approve", {
          method: "POST",
          body: JSON.stringify({ requestId: -1 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 on contract error", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.approveMultisigPayment).mockResolvedValueOnce({
        success: false,
        error: "Already approved",
      });

      const res = await postApprove(
        new Request("http://localhost/api/multisig/approve", {
          method: "POST",
          body: JSON.stringify({ requestId: 10 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("approves payment proposal successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.approveMultisigPayment).mockResolvedValueOnce({
        success: true,
        txHash: "tx_approve_123",
      });

      const res = await postApprove(
        new Request("http://localhost/api/multisig/approve", {
          method: "POST",
          body: JSON.stringify({ requestId: 10 }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.approved).toBe(true);
      expect(data.data.txHash).toBe("tx_approve_123");
    });
  });

  describe("POST /api/multisig/execute", () => {
    it("returns 400 on contract error", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.executeApprovedPayment).mockResolvedValueOnce({
        success: false,
        error: "Insufficient approvals",
      });

      const res = await postExecute(
        new Request("http://localhost/api/multisig/execute", {
          method: "POST",
          body: JSON.stringify({ requestId: 10 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("executes approved payment proposal successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.executeApprovedPayment).mockResolvedValueOnce({
        success: true,
        txHash: "tx_exec_123",
      });

      const res = await postExecute(
        new Request("http://localhost/api/multisig/execute", {
          method: "POST",
          body: JSON.stringify({ requestId: 10 }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.executed).toBe(true);
    });
  });

  describe("POST /api/multisig/propose", () => {
    it("returns 400 on contract error", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.proposeMultisigPayment).mockResolvedValueOnce({
        success: false,
        error: "Multisig is disabled",
      });

      const res = await postPropose(
        new Request("http://localhost/api/multisig/propose", {
          method: "POST",
          body: JSON.stringify({ payee: "G_PAYEE", amount: 100 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("proposes payment successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contractAdvanced.proposeMultisigPayment).mockResolvedValueOnce({
        success: true,
        txHash: "tx_prop_123",
        data: 15,
      });

      const res = await postPropose(
        new Request("http://localhost/api/multisig/propose", {
          method: "POST",
          body: JSON.stringify({ payee: "G_PAYEE", amount: 100 }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.proposalId).toBe(15);
    });
  });

  describe("GET /api/multisig/requests", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getMultisigRequests(new Request("http://localhost/api/multisig/requests"));
      expect(res.status).toBe(401);
    });

    it("returns requests array with available flag", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getMultisigRequests(new Request("http://localhost/api/multisig/requests"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.requests).toEqual([]);
      expect(data.data.available).toBe(false);
    });
  });

  describe("GET /api/timelock", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getTimelock(new Request("http://localhost/api/timelock"));
      expect(res.status).toBe(401);
    });

    it("returns 400 when ?id is invalid format", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getTimelock(new Request("http://localhost/api/timelock?id=abc"));
      expect(res.status).toBe(400);
    });

    it("returns available:false when single action simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getTimelock(new Request("http://localhost/api/timelock?id=12"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
    });

    it("returns single timelocked action on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 12, readyTimestamp: 1700000000 },
      } as never);

      const res = await getTimelock(new Request("http://localhost/api/timelock?id=12"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(12);
    });

    it("returns empty array when timelock count simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getTimelock(new Request("http://localhost/api/timelock"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it("enumerates all timelocked actions up to count", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: 2,
        } as never)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: { id: 1, action: "SET_FEE" },
        } as never)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: { id: 2, action: "SET_ADMIN" },
        } as never);

      const res = await getTimelock(new Request("http://localhost/api/timelock"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(2);
    });
  });
});
