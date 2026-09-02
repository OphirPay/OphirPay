// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: vi.fn(),
}));

import * as authSession from "@/lib/auth-session";
import * as contracts from "@/lib/contracts";
import { GET as getEscrows, POST as postEscrows } from "@/app/api/escrows/route";
import { GET as getEscrowById } from "@/app/api/escrows/[id]/route";
import { GET as getStreams, POST as postStreams } from "@/app/api/streams/route";
import { GET as getStreamById } from "@/app/api/streams/[id]/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Escrows & Streams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/api/escrows", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getEscrows(new Request("http://localhost/api/escrows"));
      expect(res.status).toBe(401);
    });

    it("GET returns total escrow count", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 12,
      } as never);

      const res = await getEscrows(new Request("http://localhost/api/escrows"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.count).toBe(12);
    });

    it("GET returns count fallback when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getEscrows(new Request("http://localhost/api/escrows"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.count).toBe(0);
      expect(data.data.available).toBe(false);
    });

    it("GET by ?id=N returns single escrow details", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 1, amount: 500, status: 0 },
      } as never);

      const res = await getEscrows(new Request("http://localhost/api/escrows?id=1"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(1);
    });

    it("GET by ?id=N returns available:false on simulation failure", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
        error: "Escrow missing",
      } as never);

      const res = await getEscrows(new Request("http://localhost/api/escrows?id=999"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postEscrows(
        new Request("http://localhost/api/escrows", { method: "POST" })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when required escrow parameters are missing", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postEscrows(
        new Request("http://localhost/api/escrows", {
          method: "POST",
          body: JSON.stringify({ depositor: "G123" }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST returns 202 with client signing instructions when parameters are valid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postEscrows(
        new Request("http://localhost/api/escrows", {
          method: "POST",
          body: JSON.stringify({
            depositor: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            beneficiary: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            amount: "100",
          }),
        })
      );
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain("wallet signing");
    });
  });

  describe("GET /api/escrows/[id]", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getEscrowById(new Request("http://localhost/api/escrows/1"), {
        params: Promise.resolve({ id: "1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when id is not a valid integer", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getEscrowById(new Request("http://localhost/api/escrows/invalid"), {
        params: Promise.resolve({ id: "invalid" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getEscrowById(new Request("http://localhost/api/escrows/99"), {
        params: Promise.resolve({ id: "99" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns escrow data on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 5, amount: 200 },
      } as never);

      const res = await getEscrowById(new Request("http://localhost/api/escrows/5"), {
        params: Promise.resolve({ id: "5" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(5);
    });
  });

  describe("/api/streams", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getStreams(new Request("http://localhost/api/streams"));
      expect(res.status).toBe(401);
    });

    it("GET returns total stream count", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 8,
      } as never);

      const res = await getStreams(new Request("http://localhost/api/streams"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.count).toBe(8);
    });

    it("GET by ?id=N returns single stream details", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 2, totalAmount: 1000 },
      } as never);

      const res = await getStreams(new Request("http://localhost/api/streams?id=2"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(2);
    });

    it("POST returns 400 when creator or recipient is missing", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postStreams(
        new Request("http://localhost/api/streams", {
          method: "POST",
          body: JSON.stringify({ creator: "G1" }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST returns 202 on valid stream parameters", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postStreams(
        new Request("http://localhost/api/streams", {
          method: "POST",
          body: JSON.stringify({
            creator: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            recipient: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            totalAmount: 500,
          }),
        })
      );
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toContain("wallet signing");
    });
  });

  describe("GET /api/streams/[id]", () => {
    it("returns 404 when id is invalid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getStreamById(new Request("http://localhost/api/streams/abc"), {
        params: Promise.resolve({ id: "abc" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when stream not found on-chain", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getStreamById(new Request("http://localhost/api/streams/99"), {
        params: Promise.resolve({ id: "99" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns stream data on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 3, totalAmount: 300 },
      } as never);

      const res = await getStreamById(new Request("http://localhost/api/streams/3"), {
        params: Promise.resolve({ id: "3" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(3);
    });
  });
});
