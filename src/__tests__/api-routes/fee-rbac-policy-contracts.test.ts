// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  EMITTER_CONTRACT_ID: "CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: vi.fn(),
}));

import * as authSession from "@/lib/auth-session";
import * as contracts from "@/lib/contracts";
import { GET as getFeeConfig } from "@/app/api/fee-config/route";
import { GET as getFeeCollector } from "@/app/api/fee-config/collector/route";
import { GET as getFeeHistory } from "@/app/api/fee-config/history/route";
import { GET as getPolicyVersions } from "@/app/api/policy-versions/route";
import { GET as getRbac } from "@/app/api/rbac/route";
import { GET as getContracts } from "@/app/api/contracts/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Fee Config, RBAC, Policy & Contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/fee-config", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getFeeConfig(new Request("http://localhost/api/fee-config"));
      expect(res.status).toBe(401);
    });

    it("returns available:false on simulation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
        error: "Contract unreachable",
      } as never);

      const res = await getFeeConfig(new Request("http://localhost/api/fee-config"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
    });

    it("returns fee config on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { feeBps: 25, feeCollector: "G_COLLECTOR" },
      } as never);

      const res = await getFeeConfig(new Request("http://localhost/api/fee-config"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.feeBps).toBe(25);
    });
  });

  describe("GET /api/fee-config/collector", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getFeeCollector(new Request("http://localhost/api/fee-config/collector"));
      expect(res.status).toBe(401);
    });

    it("returns collector:null on simulation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getFeeCollector(new Request("http://localhost/api/fee-config/collector"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
      expect(data.data.collector).toBeNull();
    });

    it("returns collector address on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: "G_COLLECTOR_1",
      } as never);

      const res = await getFeeCollector(new Request("http://localhost/api/fee-config/collector"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.collector).toBe("G_COLLECTOR_1");
    });
  });

  describe("GET /api/fee-config/history", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getFeeHistory(new Request("http://localhost/api/fee-config/history"));
      expect(res.status).toBe(401);
    });

    it("returns empty history on simulation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getFeeHistory(new Request("http://localhost/api/fee-config/history"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
      expect(data.data.versions).toEqual([]);
    });

    it("returns version history on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: [{ version: 1, feeBps: 25 }],
      } as never);

      const res = await getFeeHistory(new Request("http://localhost/api/fee-config/history"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
    });
  });

  describe("GET /api/policy-versions", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getPolicyVersions(new Request("http://localhost/api/policy-versions"));
      expect(res.status).toBe(401);
    });

    it("returns fallback empty histories when simulations fail", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({ status: "SIMULATION_FAILED" } as never)
        .mockResolvedValueOnce({ status: "SIMULATION_FAILED" } as never);

      const res = await getPolicyVersions(new Request("http://localhost/api/policy-versions"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.feeConfigHistory).toEqual([]);
      expect(data.data.multisigHistory).toEqual([]);
    });

    it("returns combined policy histories on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({ status: "SUCCESS", returnValue: [{ version: 1 }] } as never)
        .mockResolvedValueOnce({ status: "SUCCESS", returnValue: [{ version: 2 }] } as never);

      const res = await getPolicyVersions(new Request("http://localhost/api/policy-versions"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.feeConfigHistory).toHaveLength(1);
      expect(data.data.multisigHistory).toHaveLength(1);
    });
  });

  describe("GET /api/rbac", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getRbac(new Request("http://localhost/api/rbac"));
      expect(res.status).toBe(401);
    });

    it("returns contract availability when no address query is supplied", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 5,
      } as never);

      const res = await getRbac(new Request("http://localhost/api/rbac"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(true);
    });

    it("returns available:false when looking up role simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getRbac(
        new Request(
          "http://localhost/api/rbac?addr=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
    });

    it("returns user role when lookup succeeds", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 2, // Admin
      } as never);

      const res = await getRbac(
        new Request(
          "http://localhost/api/rbac?addr=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        )
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.role).toBe(2);
    });
  });

  describe("GET /api/contracts", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getContracts(new Request("http://localhost/api/contracts"));
      expect(res.status).toBe(401);
    });

    it("returns deployment info with reachable:false when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockImplementation(async (_cid, _method) => {
        return { status: "SIMULATION_FAILED", error: "rpc error" } as never;
      });

      const res = await getContracts(new Request("http://localhost/api/contracts"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.reachable).toBe(false);
      expect(data.data.contracts.ophirpay.version).toBeNull();
    });

    it("returns deployment info with reachable:true on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockImplementation(async (_cid, method) => {
        if (method === "get_version") return { status: "SUCCESS", returnValue: "1.0.0" } as never;
        if (method === "get_owner") return { status: "SUCCESS", returnValue: "G_OWNER" } as never;
        return { status: "SIMULATION_FAILED" } as never;
      });

      const res = await getContracts(new Request("http://localhost/api/contracts"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.reachable).toBe(true);
      expect(data.data.contracts.ophirpay.version).toBe("1.0.0");
      expect(data.data.contracts.ophirpay.owner).toBe("G_OWNER");
    });
  });
});
