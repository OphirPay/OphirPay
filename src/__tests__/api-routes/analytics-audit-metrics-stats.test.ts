// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", async () => {
  const { unauthorizedError } = await import("@/lib/api-response");
  return {
    withApiAuth: (handler: (req: Request, ...args: unknown[]) => Promise<Response>) => {
      return async (req: Request, ...args: unknown[]) => {
        const key = req.headers.get("x-api-key") || req.headers.get("authorization");
        if (!key || key === "invalid") {
          return unauthorizedError("Valid API key required.");
        }
        return handler(req, ...args);
      };
    },
    authenticateRequest: vi.fn(),
    requireAuth: vi.fn(),
  };
});

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  DEFAULT_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
  CHAIN_READ_SOURCE: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  simulateContractCall: vi.fn(),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import * as contracts from "@/lib/contracts";
import { GET as getAnalytics } from "@/app/api/analytics/route";
import { GET as getAuditLog } from "@/app/api/audit-log/route";
import { GET as getAuditLogSse } from "@/app/api/audit-log/sse/route";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { GET as getStats } from "@/app/api/stats/route";

const MOCK_AUTH = {
  userId: "user_123",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("API Routes: Analytics, Audit Log, Metrics & Stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/analytics", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getAnalytics(new Request("http://localhost/api/analytics"));
      expect(res.status).toBe(401);
    });

    it("returns zero metrics when user has 0 payments", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.count)
        .mockResolvedValueOnce(0) // total
        .mockResolvedValueOnce(0) // completed
        .mockResolvedValueOnce(0); // failed
      vi.mocked(prisma.payment.aggregate).mockResolvedValueOnce({
        _sum: { amount: null },
        _avg: { amount: null },
      } as never);
      vi.mocked(prisma.payment.groupBy).mockResolvedValueOnce([]);

      const res = await getAnalytics(new Request("http://localhost/api/analytics"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.totalPayments).toBe(0);
      expect(data.data.successRate).toBe(0);
      expect(data.data.totalVolume).toBe(0);
      expect(data.data.volumeByDay).toEqual([]);
    });

    it("aggregates metrics and daily volume when payments exist", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(prisma.payment.count)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // completed
        .mockResolvedValueOnce(2); // failed
      vi.mocked(prisma.payment.aggregate).mockResolvedValueOnce({
        _sum: { amount: 800 },
        _avg: { amount: 100 },
      } as never);
      vi.mocked(prisma.payment.groupBy).mockResolvedValueOnce([
        {
          createdAt: new Date("2026-08-01T00:00:00Z"),
          _count: { id: 8 },
          _sum: { amount: 800 },
        },
      ] as never);

      const res = await getAnalytics(new Request("http://localhost/api/analytics"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.totalPayments).toBe(10);
      expect(data.data.completedPayments).toBe(8);
      expect(data.data.failedPayments).toBe(2);
      expect(data.data.successRate).toBe(80);
      expect(data.data.totalVolume).toBe(800);
      expect(data.data.volumeByDay).toHaveLength(1);
      expect(data.data.volumeByDay[0].date).toBe("2026-08-01");
    });
  });

  describe("GET /api/audit-log", () => {
    it("returns 401 when API key is missing or invalid", async () => {
      const res = await getAuditLog(new Request("http://localhost/api/audit-log"));
      expect(res.status).toBe(401);
    });

    it("returns 400 on invalid query params", async () => {
      const res = await getAuditLog(
        new Request("http://localhost/api/audit-log?limit=0", {
          headers: { "x-api-key": "op_test_12345678" },
        })
      );
      expect(res.status).toBe(400);
    });

    it("returns empty audit log when simulation fails", async () => {
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getAuditLog(
        new Request("http://localhost/api/audit-log", {
          headers: { "x-api-key": "op_test_12345678" },
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
      expect(data.meta.total).toBe(0);
    });

    it("returns empty audit log when total count is 0", async () => {
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 0,
      } as never);

      const res = await getAuditLog(
        new Request("http://localhost/api/audit-log", {
          headers: { "x-api-key": "op_test_12345678" },
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toEqual([]);
    });

    it("returns audit entries when on-chain audit count > 0", async () => {
      vi.mocked(contracts.simulateContractCall)
        .mockResolvedValueOnce({ status: "SUCCESS", returnValue: 2 } as never)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: { id: 2, action: "PAYMENT", actor: "G1", timestamp: 1700000000 },
        } as never)
        .mockResolvedValueOnce({
          status: "SUCCESS",
          returnValue: { id: 1, action: "INIT", actor: "G_OWNER", timestamp: 1699999000 },
        } as never);

      const res = await getAuditLog(
        new Request("http://localhost/api/audit-log?page=1&limit=2", {
          headers: { "x-api-key": "op_test_12345678" },
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(2);
      expect(data.meta.total).toBe(2);
    });
  });

  describe("GET /api/audit-log/sse", () => {
    it("returns SSE stream response", async () => {
      const res = await getAuditLogSse(new Request("http://localhost/api/audit-log/sse"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      if (res.body) {
        await res.body.cancel();
      }
    });
  });

  describe("GET /api/metrics", () => {
    it("returns Prometheus formatted metrics text", async () => {
      const res = await getMetrics();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("ophirpay_http_requests_total");
      expect(text).toContain("ophirpay_info");
    });
  });

  describe("GET /api/stats", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(null);
      const res = await getStats(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(401);
    });

    it("returns fallback stats with available:false when simulation fails", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SIMULATION_FAILED",
      } as never);

      const res = await getStats(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.available).toBe(false);
      expect(data.data.total_payments_recorded).toBe(0);
    });

    it("returns on-chain stats on success", async () => {
      vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      vi.mocked(contracts.simulateContractCall).mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: {
          total_payments_recorded: 42,
          total_escrows_created: 10,
          total_streams_created: 5,
        },
      } as never);

      const res = await getStats(new Request("http://localhost/api/stats"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.total_payments_recorded).toBe(42);
    });
  });
});
