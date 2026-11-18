// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  const payment = {
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
  return {
    default: {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ payment })
      ),
      payment,
    },
  };
});

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/api-cache", () => ({
  cachedRead: vi.fn(async (_key, queryFn) => ({
    value: await queryFn(),
    status: "MISS",
  })),
  readCacheKey: vi.fn((prefix, id) => `${prefix}:${id}`),
  READ_TTL_MS: { analytics: 300_000 },
}));

vi.mock("@/lib/cache", () => ({
  readCacheHeaders: vi.fn(() => ({ "Cache-Control": "no-cache" })),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import { GET as getAnalytics } from "@/app/api/analytics/route";
import {
  getAnalyticsMetrics,
  ANALYTICS_QUERY_TIMEOUT_MS,
} from "@/lib/db/analytics";
import { TimeoutError } from "@/lib/timeout";

const MOCK_AUTH = {
  userId: "user_timeout_test",
  publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("Analytics Query Timeout & RFC 7807 Gateway Timeout (Issue #2024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (tx: unknown) => Promise<unknown>) => callback(prisma)) as never
    );
  });

  it("configures a default query timeout of 5000ms", () => {
    expect(ANALYTICS_QUERY_TIMEOUT_MS).toBe(5000);
  });

  it("aborts cleanly and throws TimeoutError when aggregation query exceeds timeout", async () => {
    vi.mocked(prisma.payment.count).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(10), 200))
    );

    const fromDate = new Date("2026-01-01");
    const toDate = new Date("2026-02-01");

    await expect(
      getAnalyticsMetrics({ userId: "user_123" }, fromDate, toDate, {
        timeoutMs: 50,
      })
    ).rejects.toThrow(TimeoutError);
  });

  it("converts Prisma P2028 transaction timeout into a classified TimeoutError", async () => {
    const p2028Error = new Error("Transaction API error: transaction timed out");
    (p2028Error as unknown as { code: string }).code = "P2028";

    vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2028Error);

    const fromDate = new Date("2026-01-01");
    const toDate = new Date("2026-02-01");

    await expect(
      getAnalyticsMetrics({ userId: "user_123" }, fromDate, toDate, {
        timeoutMs: 1000,
      })
    ).rejects.toThrow(TimeoutError);
  });

  it("returns RFC 7807 504 Gateway Timeout response from GET /api/analytics when query times out", async () => {
    vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);

    vi.mocked(prisma.payment.count).mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new TimeoutError(5000, "Analytics aggregation query")), 10)
        )
    );

    const req = new Request("http://localhost/api/analytics");
    const res = await getAnalytics(req);

    expect(res.status).toBe(504);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");

    const problem = await res.json();
    expect(problem.status).toBe(504);
    expect(problem.title).toBe("Gateway Timeout");
    expect(problem.code).toBe("GATEWAY_TIMEOUT");
    expect(problem.type).toBe("https://ophirpay.dev/problems/gateway-timeout");
    expect(problem.detail).toContain("timed out after 5 seconds");
    expect(problem.instance).toBe("/api/analytics");
  });

  it("executes successfully when queries complete within the 5s budget", async () => {
    vi.mocked(authSession.getAuthContext).mockResolvedValueOnce(MOCK_AUTH);

    vi.mocked(prisma.payment.count)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);

    vi.mocked(prisma.payment.aggregate).mockResolvedValueOnce({
      _sum: { amount: 1500 },
      _avg: { amount: 100 },
    } as never);

    vi.mocked(prisma.payment.groupBy).mockResolvedValueOnce([
      {
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
        _count: { id: 12 },
        _sum: { amount: 1500 },
      },
    ] as never);

    const req = new Request("http://localhost/api/analytics");
    const res = await getAnalytics(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalPayments).toBe(15);
    expect(body.data.completedPayments).toBe(12);
    expect(body.data.failedPayments).toBe(3);
    expect(body.data.successRate).toBe(80);
    expect(body.data.totalVolume).toBe(1500);
  });
});
