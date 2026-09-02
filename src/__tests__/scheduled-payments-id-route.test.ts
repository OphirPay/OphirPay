// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import {
  GET,
  PATCH,
  DELETE,
} from "@/app/api/scheduled/[id]/route";

// ── Mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    scheduledPayment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

// ── Fixtures ───────────────────────────────────────────────────

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const OTHER_AUTH = {
  userId: "user_999",
  publicKey: "G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3",
};

const VALID_ADDRESS = "G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3";

function scheduledPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched_1",
    userId: MOCK_AUTH.userId,
    amount: { toString: () => "100" },
    assetCode: "XLM",
    assetIssuer: null,
    destAddress: VALID_ADDRESS,
    memo: "Rent",
    scheduledFor: new Date(Date.now() + 86_400_000),
    status: "SCHEDULED",
    transactionHash: null,
    errorMessage: null,
    executedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("/api/scheduled/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);

      const res = await GET(
        new Request("http://localhost/api/scheduled/sched_1"),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(401);
    });

    it("returns 404 when the payment does not exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(null);

      const res = await GET(
        new Request("http://localhost/api/scheduled/sched_missing"),
        { params: Promise.resolve({ id: "sched_missing" }) }
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 when the payment belongs to another user", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment({ userId: OTHER_AUTH.userId }) as never
      );

      const res = await GET(
        new Request("http://localhost/api/scheduled/sched_1"),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(404);
    });

    it("returns the payment with amount serialized as a string", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );

      const res = await GET(
        new Request("http://localhost/api/scheduled/sched_1"),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe("sched_1");
      expect(data.data.amount).toBe("100");
      expect(data.data.status).toBe("SCHEDULED");
    });
  });

  describe("PATCH", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({ amount: 50 }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(401);
    });

    it("returns 404 when the payment does not exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(null);

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({ amount: 50 }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(404);
    });

    it("returns 400 when the payment is not SCHEDULED", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment({ status: "EXECUTED" }) as never
      );

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({ amount: 50 }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("Only SCHEDULED payments can be edited");
    });

    it("returns 400 when the body fails validation", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({ amount: -10 }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(400);
    });

    it("updates amount and scheduledFor", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );
      vi.mocked(prisma.scheduledPayment.update).mockResolvedValueOnce(
        scheduledPayment({
          amount: { toString: () => "50" },
          scheduledFor: new Date("2099-12-31T23:59:59.000Z"),
        }) as never
      );

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({
            amount: 50,
            scheduledFor: "2099-12-31T23:59:59.000Z",
          }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.amount).toBe("50");

      expect(prisma.scheduledPayment.update).toHaveBeenCalledWith({
        where: { id: "sched_1" },
        data: expect.objectContaining({
          amount: 50,
          scheduledFor: new Date("2099-12-31T23:59:59.000Z"),
        }),
      });
    });

    it("rejects a past scheduledFor date", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({
            scheduledFor: "2020-01-01T00:00:00.000Z",
          }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
      expect(data.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "scheduledFor", message: "Scheduled date must be in the future" }),
        ])
      );
    });

    it("updates memo and destAddress", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );
      vi.mocked(prisma.scheduledPayment.update).mockResolvedValueOnce(
        scheduledPayment({
          memo: "Updated memo",
          destAddress: VALID_ADDRESS,
        }) as never
      );

      const res = await PATCH(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "PATCH",
          body: JSON.stringify({
            memo: "Updated memo",
            destAddress: VALID_ADDRESS,
          }),
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(200);
      expect(prisma.scheduledPayment.update).toHaveBeenCalledWith({
        where: { id: "sched_1" },
        data: expect.objectContaining({
          memo: "Updated memo",
          destAddress: VALID_ADDRESS,
        }),
      });
    });
  });

  describe("DELETE", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);

      const res = await DELETE(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(401);
    });

    it("returns 404 when the payment does not exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(null);

      const res = await DELETE(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(404);
    });

    it("returns 400 when the payment is not SCHEDULED", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment({ status: "FAILED" }) as never
      );

      const res = await DELETE(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("Only SCHEDULED payments can be cancelled");
    });

    it("cancels a SCHEDULED payment", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.scheduledPayment.findUnique).mockResolvedValueOnce(
        scheduledPayment() as never
      );
      vi.mocked(prisma.scheduledPayment.update).mockResolvedValueOnce(
        scheduledPayment({ status: "CANCELLED" }) as never
      );

      const res = await DELETE(
        new Request("http://localhost/api/scheduled/sched_1", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "sched_1" }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe("CANCELLED");
      expect(prisma.scheduledPayment.update).toHaveBeenCalledWith({
        where: { id: "sched_1" },
        data: { status: "CANCELLED" },
      });
    });
  });
});
