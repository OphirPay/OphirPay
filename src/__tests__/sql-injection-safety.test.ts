// SPDX-License-Identifier: MIT
// Issue #1396 — Regression tests for SQL injection prevention, safe analytics date filtering, and CI static analysis.

import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { Prisma } from "@/lib/prisma";
import { GET } from "@/app/api/analytics/route";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(async () => ({ userId: "user-test-sql", publicKey: "GTEST123" })),
}));

vi.mock("@/lib/prisma", async () => {
  const actualPrisma = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return {
    default: {
      payment: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async () => ({
          _count: { id: 0 },
          _sum: { amount: 0 },
          _avg: { amount: 0 },
        })),
        groupBy: vi.fn(async () => []),
      },
    },
    Prisma: actualPrisma.Prisma,
  };
});

import prisma from "@/lib/prisma";

describe("SQL Injection Safety (Issue #1396)", () => {
  describe("Prisma.sql parameterization export", () => {
    it("exports Prisma from src/lib/prisma with tagged template support", () => {
      expect(Prisma).toBeDefined();
      expect(typeof Prisma.sql).toBe("function");

      const userId = "user-123";
      const fragment = Prisma.sql`WHERE "userId" = ${userId}`;
      expect(fragment.strings).toBeDefined();
      expect(fragment.values).toEqual([userId]);
    });
  });

  describe("scripts/check-sql-injection.mjs CI audit script", () => {
    it("runs successfully on current codebase with zero SQL injection violations", () => {
      const scriptPath = path.join(process.cwd(), "scripts", "check-sql-injection.mjs");
      const output = execFileSync(process.execPath, [scriptPath], {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(output).toContain("SQL injection check passed: zero unparameterized raw SQL queries found");
    });
  });

  describe("Analytics endpoint date filter sanitization", () => {
    it("rejects malicious SQL injection payloads in 'from' date filter with 400", async () => {
      const maliciousDate = "2026-01-01' OR '1'='1";
      const req = new Request(
        `http://localhost/api/analytics?from=${encodeURIComponent(maliciousDate)}`
      );

      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it("rejects malicious SQL injection payloads in 'to' date filter with 400", async () => {
      const maliciousPayload = "'; DROP TABLE \"Payment\"; --";
      const req = new Request(
        `http://localhost/api/analytics?to=${encodeURIComponent(maliciousPayload)}`
      );

      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts valid ISO date strings and safely queries payments scoped to user", async () => {
      const validFrom = "2026-01-01T00:00:00.000Z";
      const validTo = "2026-01-31T23:59:59.999Z";
      const req = new Request(
        `http://localhost/api/analytics?from=${encodeURIComponent(validFrom)}&to=${encodeURIComponent(validTo)}`
      );

      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      expect(prisma.payment.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-test-sql",
            createdAt: expect.objectContaining({
              gte: new Date(validFrom),
              lte: new Date(validTo),
            }),
          }),
        })
      );
    });
  });
});
