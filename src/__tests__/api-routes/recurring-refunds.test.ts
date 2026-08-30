// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    recurrence: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    refund: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

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

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as csrf from "@/lib/csrf";
import * as contracts from "@/lib/contracts";
import { GET as getRecurring, POST as postRecurring } from "@/app/api/recurring/route";
import { GET as getRecurringById } from "@/app/api/recurring/[id]/route";
import { GET as getRefunds, POST as postRefunds } from "@/app/api/refunds/route";
import { PATCH as patchRefundById } from "@/app/api/refunds/[id]/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};
const VALID_STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("API Routes: Recurring & Refunds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrf.verifyCsrf).mockReturnValue(null);
  });

  describe("/api/recurring", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getRecurring(new Request("http://localhost/api/recurring"));
      expect(res.status).toBe(401);
    });

    it("GET returns 400 on bad pagination params", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getRecurring(new Request("http://localhost/api/recurring?limit=0"));
      expect(res.status).toBe(400);
    });

    it("GET returns paginated recurrences", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockList = [{ id: "rec_1", name: "Monthly SaaS", frequency: "MONTHLY" }];
      vi.mocked(prisma.recurrence.findMany).mockResolvedValueOnce(mockList as never);
      vi.mocked(prisma.recurrence.count).mockResolvedValueOnce(1);

      const res = await getRecurring(new Request("http://localhost/api/recurring?page=1&limit=10"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postRecurring(
        new Request("http://localhost/api/recurring", { method: "POST" })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when body fails schema validation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postRecurring(
        new Request("http://localhost/api/recurring", {
          method: "POST",
          body: JSON.stringify({ name: "", frequency: "INVALID" }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates recurrence with correct nextRunAt for all frequencies", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValue(MOCK_AUTH);

      const frequencies = [
        "DAILY",
        "WEEKLY",
        "BIWEEKLY",
        "MONTHLY",
        "QUARTERLY",
        "YEARLY",
      ] as const;
      for (const freq of frequencies) {
        vi.mocked(prisma.recurrence.create).mockResolvedValueOnce({
          id: `rec_${freq}`,
          frequency: freq,
          name: `${freq} Sub`,
        } as never);

        const res = await postRecurring(
          new Request("http://localhost/api/recurring", {
            method: "POST",
            body: JSON.stringify({
              name: `${freq} Sub`,
              frequency: freq,
              amount: 50,
              assetCode: "XLM",
              destAddress: VALID_STELLAR_ADDR,
              sourceAccountId: "source_acc_1",
            }),
          })
        );
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.data.id).toBe(`rec_${freq}`);
      }
    });
  });

  describe("GET /api/recurring/[id]", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getRecurringById(new Request("http://localhost/api/recurring/1"), {
        params: Promise.resolve({ id: "1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when id is not an integer", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await getRecurringById(new Request("http://localhost/api/recurring/not_int"), {
        params: Promise.resolve({ id: "not_int" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getRecurringById(new Request("http://localhost/api/recurring/5"), {
        params: Promise.resolve({ id: "5" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns recurring details on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: { id: 5, amount: 50, frequency: "MONTHLY" },
      } as never);

      const res = await getRecurringById(new Request("http://localhost/api/recurring/5"), {
        params: Promise.resolve({ id: "5" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(5);
    });
  });

  describe("/api/refunds", () => {
    it("GET returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getRefunds(new Request("http://localhost/api/refunds"));
      expect(res.status).toBe(401);
    });

    it("GET returns refund list for authenticated user", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockRefunds = [{ id: "ref_1", amount: 10, reason: "Duplicate" }];
      vi.mocked(prisma.refund.findMany).mockResolvedValueOnce(mockRefunds as never);

      const res = await getRefunds(new Request("http://localhost/api/refunds"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
    });

    it("GET with ?analytics=true returns aggregated reason code buckets", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockRefunds = [{ reasonCode: 0 }, { reasonCode: 0 }, { reasonCode: 2 }];
      vi.mocked(prisma.refund.findMany).mockResolvedValueOnce(mockRefunds as never);

      const res = await getRefunds(new Request("http://localhost/api/refunds?analytics=true"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(6);
      expect(data.data[0]).toEqual({ code: 0, count: 2 });
      expect(data.data[2]).toEqual({ code: 2, count: 1 });
    });

    it("POST returns 403 on CSRF failure", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF token invalid" } }), {
          status: 403,
        })
      );
      const res = await postRefunds(
        new Request("http://localhost/api/refunds", { method: "POST" })
      );
      expect(res.status).toBe(403);
    });

    it("POST returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await postRefunds(
        new Request("http://localhost/api/refunds", {
          method: "POST",
          body: JSON.stringify({
            paymentId: 1,
            amount: 50,
            asset: "native",
            reason: "Wrong item",
            reasonCode: 1,
          }),
        })
      );
      expect(res.status).toBe(401);
    });

    it("POST returns 400 when request body fails validation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await postRefunds(
        new Request("http://localhost/api/refunds", {
          method: "POST",
          body: JSON.stringify({ amount: -10 }),
        })
      );
      expect(res.status).toBe(400);
    });

    it("POST creates a refund ledger row successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const mockCreated = {
        id: "ref_new_1",
        paymentId: "101",
        amount: 25,
        asset: "native",
        reason: "Defective item",
        reasonCode: 1,
        onChainId: 7,
      };
      vi.mocked(prisma.refund.create).mockResolvedValueOnce(mockCreated as never);

      const res = await postRefunds(
        new Request("http://localhost/api/refunds", {
          method: "POST",
          body: JSON.stringify({
            paymentId: 101,
            amount: 25,
            asset: "native",
            reason: "Defective item",
            reasonCode: 1,
            onChainId: 7,
          }),
        })
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.id).toBe("ref_new_1");
    });
  });

  describe("PATCH /api/refunds/[id]", () => {
    it("returns 403 when CSRF check fails", async () => {
      vi.mocked(csrf.verifyCsrf).mockReturnValueOnce(
        new Response(JSON.stringify({ success: false, error: { message: "CSRF invalid" } }), {
          status: 403,
        })
      );
      const res = await patchRefundById(
        new Request("http://localhost/api/refunds/ref_1", {
          method: "PATCH",
          body: JSON.stringify({ status: "APPROVED" }),
        }),
        { params: Promise.resolve({ id: "ref_1" }) }
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await patchRefundById(
        new Request("http://localhost/api/refunds/ref_1", {
          method: "PATCH",
          body: JSON.stringify({ status: "APPROVED" }),
        }),
        { params: Promise.resolve({ id: "ref_1" }) }
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 when status is invalid", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await patchRefundById(
        new Request("http://localhost/api/refunds/ref_1", {
          method: "PATCH",
          body: JSON.stringify({ status: "INVALID_STATUS" }),
        }),
        { params: Promise.resolve({ id: "ref_1" }) }
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when refund is not found", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.refund.updateMany).mockResolvedValueOnce({ count: 0 });

      const res = await patchRefundById(
        new Request("http://localhost/api/refunds/ref_none", {
          method: "PATCH",
          body: JSON.stringify({ status: "APPROVED" }),
        }),
        { params: Promise.resolve({ id: "ref_none" }) }
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("Refund not found");
    });

    it("updates refund status successfully", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.refund.updateMany).mockResolvedValueOnce({ count: 1 });

      const res = await patchRefundById(
        new Request("http://localhost/api/refunds/ref_1", {
          method: "PATCH",
          body: JSON.stringify({ status: "PROCESSED" }),
        }),
        { params: Promise.resolve({ id: "ref_1" }) }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.updated).toBe(true);
    });
  });
});
