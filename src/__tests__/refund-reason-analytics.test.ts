// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  REFUND_REASON_CATALOG,
  getRefundReasonLabel,
  toRefundReasonChartData,
  toRefundTrendChartData,
  MAX_REFUND_ANALYTICS_WINDOW,
  REFUND_WINDOW_LIMITATION_NOTICE,
} from "@/lib/chart-data";

const { mockFindMany, mockCount, mockAggregate, mockGroupBy, mockGetAuthContext } =
  vi.hoisted(() => ({
    mockFindMany: vi.fn(),
    mockCount: vi.fn(),
    mockAggregate: vi.fn(),
    mockGroupBy: vi.fn(),
    mockGetAuthContext: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  default: {
    refund: {
      findMany: mockFindMany,
      count: mockCount,
    },
    payment: {
      count: mockCount,
      aggregate: mockAggregate,
      groupBy: mockGroupBy,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET as getRefunds } from "@/app/api/refunds/route";
import { GET as getAnalytics } from "@/app/api/analytics/route";

describe("Refund Reason Code Analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Catalog & Formatting Utilities", () => {
    it("defines all 6 Soroban contract refund reason codes (0 to 5)", () => {
      expect(Object.keys(REFUND_REASON_CATALOG)).toHaveLength(6);
      expect(REFUND_REASON_CATALOG[0].name).toBe("ProductDefect");
      expect(REFUND_REASON_CATALOG[0].label).toBe("Product Defect");
      expect(REFUND_REASON_CATALOG[1].name).toBe("NonDelivery");
      expect(REFUND_REASON_CATALOG[1].label).toBe("Non-Delivery");
      expect(REFUND_REASON_CATALOG[2].name).toBe("DuplicateCharge");
      expect(REFUND_REASON_CATALOG[2].label).toBe("Duplicate Charge");
      expect(REFUND_REASON_CATALOG[3].name).toBe("Unauthorized");
      expect(REFUND_REASON_CATALOG[3].label).toBe("Unauthorized Charge");
      expect(REFUND_REASON_CATALOG[4].name).toBe("CustomerRequest");
      expect(REFUND_REASON_CATALOG[4].label).toBe("Customer Request");
      expect(REFUND_REASON_CATALOG[5].name).toBe("Other");
      expect(REFUND_REASON_CATALOG[5].label).toBe("Other Reason");
    });

    it("retrieves human-readable labels via getRefundReasonLabel", () => {
      expect(getRefundReasonLabel(0)).toBe("Product Defect");
      expect(getRefundReasonLabel(4)).toBe("Customer Request");
      expect(getRefundReasonLabel(99)).toBe("Reason Code #99");
    });

    it("enforces the smart contract bounded window limit and notice", () => {
      expect(MAX_REFUND_ANALYTICS_WINDOW).toBe(100);
      expect(REFUND_WINDOW_LIMITATION_NOTICE).toContain("most recent window of up to 100 refunds");
      expect(REFUND_WINDOW_LIMITATION_NOTICE).toContain("smart contract");
    });

    it("transforms raw reason counts into chart data with correct percentages", () => {
      const rawCounts = [
        { code: 0, count: 10 },
        { code: 1, count: 5 },
        { code: 2, count: 5 },
        { code: 3, count: 0 },
        { code: 4, count: 0 },
        { code: 5, count: 0 },
      ];

      const chartData = toRefundReasonChartData(rawCounts);
      expect(chartData).toHaveLength(6);
      expect(chartData[0].label).toBe("Product Defect");
      expect(chartData[0].count).toBe(10);
      expect(chartData[0].percentage).toBe(50);
      expect(chartData[1].label).toBe("Non-Delivery");
      expect(chartData[1].count).toBe(5);
      expect(chartData[1].percentage).toBe(25);
      expect(chartData[3].count).toBe(0);
      expect(chartData[3].percentage).toBe(0);
    });

    it("handles zero total refunds safely in toRefundReasonChartData", () => {
      const emptyCounts = [0, 1, 2, 3, 4, 5].map((code) => ({ code, count: 0 }));
      const chartData = toRefundReasonChartData(emptyCounts);
      expect(chartData).toHaveLength(6);
      for (const item of chartData) {
        expect(item.count).toBe(0);
        expect(item.percentage).toBe(0);
      }
    });

    it("aggregates refund trends by day and reason code", () => {
      const refunds = [
        { reasonCode: 0, requestedAt: "2026-03-01T10:00:00Z" },
        { reasonCode: 0, requestedAt: "2026-03-01T12:00:00Z" },
        { reasonCode: 1, requestedAt: "2026-03-01T14:00:00Z" },
        { reasonCode: 4, requestedAt: "2026-03-02T09:00:00Z" },
      ];

      const trends = toRefundTrendChartData(refunds);
      expect(trends).toHaveLength(2);
      expect(trends[0].date).toBe("2026-03-01");
      expect(trends[0].total).toBe(3);
      expect(trends[0].byReason[0]).toBe(2);
      expect(trends[0].byReason[1]).toBe(1);
      expect(trends[1].date).toBe("2026-03-02");
      expect(trends[1].total).toBe(1);
      expect(trends[1].byReason[4]).toBe(1);
    });
  });

  describe("API Endpoint Integration", () => {
    const mockAuth = { userId: "user-analytics-test", wallet: "GDTEST..." };

    it("returns detailed refund analytics with range and window notice", async () => {
      mockGetAuthContext.mockResolvedValueOnce(mockAuth);
      const mockRefunds = [
        { reasonCode: 0, requestedAt: new Date("2026-03-01T10:00:00Z") },
        { reasonCode: 0, requestedAt: new Date("2026-03-01T11:00:00Z") },
        { reasonCode: 4, requestedAt: new Date("2026-03-02T10:00:00Z") },
      ];
      mockFindMany.mockResolvedValueOnce(mockRefunds);

      const req = new Request("http://localhost/api/refunds?analytics=true&detailed=true&range=30d");
      const res = await getRefunds(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(3);
      expect(json.data.range).toBe("30d");
      expect(json.data.maxWindow).toBe(100);
      expect(json.data.windowNotice).toBe(REFUND_WINDOW_LIMITATION_NOTICE);
      expect(json.data.buckets).toHaveLength(6);
      expect(json.data.buckets[0].label).toBe("Product Defect");
      expect(json.data.buckets[0].count).toBe(2);
      expect(json.data.buckets[4].label).toBe("Customer Request");
      expect(json.data.buckets[4].count).toBe(1);
      expect(json.data.trends).toHaveLength(2);
    });

    it("maintains backward compatibility when detailed/range is omitted", async () => {
      mockGetAuthContext.mockResolvedValueOnce(mockAuth);
      const mockRefunds = [{ reasonCode: 2, requestedAt: new Date() }];
      mockFindMany.mockResolvedValueOnce(mockRefunds);

      const req = new Request("http://localhost/api/refunds?analytics=true");
      const res = await getRefunds(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(6);
      expect(json.data[2]).toEqual({ code: 2, count: 1 });
    });

    it("surfaces refund analytics in GET /api/analytics with bounded window", async () => {
      mockGetAuthContext.mockResolvedValueOnce(mockAuth);
      mockCount
        .mockResolvedValueOnce(10) // totalPayments
        .mockResolvedValueOnce(8)  // completedPayments
        .mockResolvedValueOnce(2); // failedPayments
      mockAggregate.mockResolvedValueOnce({ _sum: { amount: 500 }, _avg: { amount: 50 } });
      mockGroupBy.mockResolvedValueOnce([]);
      mockFindMany.mockResolvedValueOnce([
        { id: "ref-1", reasonCode: 3, requestedAt: new Date("2026-03-01T12:00:00Z") },
      ]);

      const req = new Request("http://localhost/api/analytics?range=30d");
      const res = await getAnalytics(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.refundAnalytics).toBeDefined();
      expect(json.data.refundAnalytics.maxWindow).toBe(100);
      expect(json.data.refundAnalytics.totalRefundsInWindow).toBe(1);
      expect(json.data.refundAnalytics.windowNotice).toBe(REFUND_WINDOW_LIMITATION_NOTICE);
      expect(json.data.refundAnalytics.reasons[3].label).toBe("Unauthorized Charge");
      expect(json.data.refundAnalytics.reasons[3].count).toBe(1);
    });
  });
});
