// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeCsvField as clientSanitize, escapeCsvField as clientEscape } from "@/lib/csv";
import {
  sanitizeCsvField as serverSanitize,
  escapeCsvField as serverEscape,
  buildPaymentCsv,
  type PaymentRecord,
} from "@/lib/export-csv";

const { mockPaymentFindMany, mockGetAuthContext } = vi.hoisted(() => ({
  mockPaymentFindMany: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { payment: { findMany: mockPaymentFindMany } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET as exportCsvRoute } from "@/app/api/export/csv/route";

describe("Issue #1959: CSV formula injection sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sanitizeCsvField", () => {
    it("prefixes cell values starting with = with a single quote", () => {
      expect(clientSanitize("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(serverSanitize("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
    });

    it("prefixes cell values starting with + with a single quote", () => {
      expect(clientSanitize("+123456789")).toBe("'+123456789");
      expect(serverSanitize("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    });

    it("prefixes cell values starting with - with a single quote", () => {
      expect(clientSanitize("-50.00")).toBe("'-50.00");
      expect(serverSanitize("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    });

    it("prefixes cell values starting with @ with a single quote", () => {
      expect(clientSanitize("@SUM(1+1)")).toBe("'@SUM(1+1)");
      expect(serverSanitize("@attacker.com")).toBe("'@attacker.com");
    });

    it("leaves safe text, numbers, and null/undefined values untouched", () => {
      expect(clientSanitize("Payment for invoice #100")).toBe("Payment for invoice #100");
      expect(clientSanitize("GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U")).toBe(
        "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U"
      );
      expect(clientSanitize(100)).toBe("100");
      expect(clientSanitize("")).toBe("");
      expect(clientSanitize(null)).toBe("");
      expect(clientSanitize(undefined)).toBe("");
    });
  });

  describe("escapeCsvField with formula sanitization", () => {
    it("escapes and quotes dangerous formulas containing commas or double quotes", () => {
      const input = '=HYPERLINK("http://evil.com","Click Me")';
      const escaped = clientEscape(input, ",");
      expect(escaped.startsWith('"\'=HYPERLINK')).toBe(true);
      expect(escaped).toBe('"\'=HYPERLINK(""http://evil.com"",""Click Me"")"');
    });

    it("server escapeCsvField applies sanitization and RFC 4180 quoting", () => {
      const input = "+1,000.00";
      expect(serverEscape(input)).toBe('"\'\+1,000.00"');
    });
  });

  describe("buildPaymentCsv", () => {
    it("safely neutralizes formula payloads in memo and description", () => {
      const records: PaymentRecord[] = [
        {
          id: "pay_1",
          amount: "100.00",
          currency: "XLM",
          status: "SUCCESS",
          created_at: "2026-11-19T00:00:00.000Z",
          memo: "=1+1",
          tx_hash: "@hash123",
        },
      ];

      const csv = buildPaymentCsv(records);
      expect(csv).toContain("'=1+1");
      expect(csv).toContain("'@hash123");
    });
  });

  describe("GET /api/export/csv route", () => {
    it("returns 401 for unauthenticated requests", async () => {
      mockGetAuthContext.mockResolvedValue(null);
      const req = new Request("http://localhost/api/export/csv");
      const res = await exportCsvRoute(req);
      expect(res.status).toBe(401);
    });

    it("returns sanitized CSV for authenticated users", async () => {
      mockGetAuthContext.mockResolvedValue({ userId: "user-1959" });
      mockPaymentFindMany.mockResolvedValue([
        {
          id: "pay_1",
          amount: { toString: () => "50.0000000" },
          assetCode: "USDC",
          status: "SUCCESS",
          createdAt: new Date("2026-11-19T00:00:00.000Z"),
          memo: "=cmd|'/C calc'!A0",
          transactionHash: "-tx-hash-dangerous",
        },
      ]);

      const req = new Request("http://localhost/api/export/csv");
      const res = await exportCsvRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      const text = await res.text();
      expect(text).toContain("'=cmd|'/C calc'!A0");
      expect(text).toContain("'-tx-hash-dangerous");
    });
  });
});
