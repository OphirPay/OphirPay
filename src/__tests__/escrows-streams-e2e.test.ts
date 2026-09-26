// SPDX-License-Identifier: MIT
//
// Issue #710 — E2E API coverage for escrows and streams.
//
// Drives the four endpoints through the running server with the contract
// calls mocked at the boundary.

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
import { generateCsrfToken } from "@/lib/csrf";
import { POST as postEscrows } from "@/app/api/escrows/route";
import { GET as getEscrowById } from "@/app/api/escrows/[id]/route";
import { POST as postStreams } from "@/app/api/streams/route";
import { GET as getStreamById } from "@/app/api/streams/[id]/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

function postRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("E2E API Routes: Escrows & Streams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/api/escrows", () => {
    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const req = postRequest("http://localhost/api/escrows", { depositor: "foo", beneficiary: "bar", amount: "100" });
      const res = await postEscrows(req);
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when missing required fields", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const req = postRequest("http://localhost/api/escrows", { depositor: "foo" });
      const res = await postEscrows(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(JSON.stringify(data.error)).toMatch(/required|invalid/i);
    });

    it("POST returns 202 instructing client to sign transaction", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const payload = { depositor: "foo", beneficiary: "bar", amount: "100" };
      const req = postRequest("http://localhost/api/escrows", payload);
      const res = await postEscrows(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toMatch(/requires wallet signing/);
      expect(data.data.params.amount).toBe("100");
    });
  });

  describe("/api/escrows/[id]", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getEscrowById(new Request("http://localhost/api/escrows/1"), { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(401);
    });

    it("GET returns 400 for invalid ID format", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getEscrowById(new Request("http://localhost/api/escrows/abc"), { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
    });

    it("GET returns 404 when escrow not found in contract", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getEscrowById(new Request("http://localhost/api/escrows/99"), { params: Promise.resolve({ id: "99" }) });
      expect(res.status).toBe(404);
    });

    it("GET returns escrow data on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 1, amount: 500, status: 0 },
      } as never);

      const res = await getEscrowById(new Request("http://localhost/api/escrows/1"), { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.amount).toBe(500);
    });
  });

  describe("/api/streams", () => {
    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const req = postRequest("http://localhost/api/streams", { creator: "foo", recipient: "bar", totalAmount: "100" });
      const res = await postStreams(req);
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when missing required fields", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const req = postRequest("http://localhost/api/streams", { creator: "foo" });
      const res = await postStreams(req);
      expect(res.status).toBe(400);
    });

    it("POST returns 202 instructing client to sign transaction", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const payload = { creator: "foo", recipient: "bar", totalAmount: "100" };
      const req = postRequest("http://localhost/api/streams", payload);
      const res = await postStreams(req);
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.data.message).toMatch(/requires wallet signing/);
      expect(data.data.params.totalAmount).toBe("100");
    });
  });

  describe("/api/streams/[id]", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getStreamById(new Request("http://localhost/api/streams/1"), { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(401);
    });

    it("GET returns 404 for invalid ID format", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getStreamById(new Request("http://localhost/api/streams/abc"), { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(404);
    });

    it("GET returns 404 when stream not found in contract", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getStreamById(new Request("http://localhost/api/streams/99"), { params: Promise.resolve({ id: "99" }) });
      expect(res.status).toBe(404);
    });

    it("GET returns stream data on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 1, totalAmount: 1000, claimedAmount: 200 },
      } as never);

      const res = await getStreamById(new Request("http://localhost/api/streams/1"), { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.totalAmount).toBe(1000);
    });
  });
});
