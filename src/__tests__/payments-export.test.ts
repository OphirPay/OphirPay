// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { buildPaymentWhere, PAYMENT_ORDER_BY } from "@/lib/payment-filters";
import {
  EXPORT_COLUMNS,
  MAX_EXPORT_ROWS,
  exportColumnSpec,
  exportFilename,
  toExportRow,
} from "@/lib/payment-export";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";

// ─── Filter parity ──────────────────────────────────────────────
//
// The export endpoint reuses these helpers so that it resolves the same rows as
// the list endpoint. These tests pin that contract.

describe("buildPaymentWhere", () => {
  it("always scopes to the authenticated user", () => {
    expect(buildPaymentWhere({ userId: "u1" })).toEqual({ userId: "u1" });
  });

  it("applies an exact status filter", () => {
    expect(buildPaymentWhere({ userId: "u1", status: "COMPLETED" })).toEqual({
      userId: "u1",
      status: "COMPLETED",
    });
  });

  it("searches description, memo and transaction hash", () => {
    const where = buildPaymentWhere({ userId: "u1", search: "abc" });
    expect(where.OR).toEqual([
      { description: { contains: "abc" } },
      { memo: { contains: "abc" } },
      { transactionHash: { contains: "abc" } },
    ]);
  });

  it("combines status and search without dropping the user scope", () => {
    const where = buildPaymentWhere({
      userId: "u1",
      status: "FAILED",
      search: "xyz",
    });
    expect(where.userId).toBe("u1");
    expect(where.status).toBe("FAILED");
    expect(Array.isArray(where.OR)).toBe(true);
  });

  it("omits empty filters rather than matching on empty strings", () => {
    expect(buildPaymentWhere({ userId: "u1", status: "", search: "" })).toEqual({
      userId: "u1",
    });
  });

  it("orders newest first", () => {
    expect(PAYMENT_ORDER_BY).toEqual({ createdAt: "desc" });
  });
});

// ─── Row shaping ────────────────────────────────────────────────

describe("toExportRow", () => {
  it("includes memo and transaction hash", () => {
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    expect(keys).toContain("memo");
    expect(keys).toContain("transactionHash");
  });

  it("renders dates as ISO-8601 rather than locale text", () => {
    const row = toExportRow({ createdAt: new Date("2026-08-26T10:20:30.000Z") });
    expect(row.createdAt).toBe("2026-08-26T10:20:30.000Z");
  });

  it("renders null and undefined as empty strings", () => {
    const row = toExportRow({ memo: null, description: undefined });
    expect(row.memo).toBe("");
    expect(row.description).toBe("");
  });

  it("preserves decimal amounts exactly via toString", () => {
    // Stand-in for Prisma's Decimal, which is an object with a toString().
    const decimal = { toString: () => "123.4567890" };
    expect(toExportRow({ amount: decimal }).amount).toBe("123.4567890");
  });

  it("produces a value for every declared column", () => {
    const row = toExportRow({});
    for (const c of EXPORT_COLUMNS) {
      expect(row[c.key]).toBe("");
    }
  });
});

describe("exportFilename", () => {
  it("embeds the date", () => {
    expect(exportFilename(new Date("2026-08-26T23:59:59.000Z"))).toBe(
      "ophirpay-payments-2026-08-26.csv"
    );
  });
});

describe("MAX_EXPORT_ROWS", () => {
  it("is a positive bound", () => {
    expect(MAX_EXPORT_ROWS).toBeGreaterThan(0);
  });
});

// ─── CSV builder output ─────────────────────────────────────────

describe("toCsvString for exported payments", () => {
  it("writes the declared headers in order", () => {
    const csv = toCsvString([], exportColumnSpec());
    expect(csv.split("\n")[0]).toBe(
      EXPORT_COLUMNS.map((c) => c.header).join(",")
    );
  });

  it("quotes fields containing a carriage return (RFC 4180 §2.6)", () => {
    // A bare CR previously went through unquoted, which splits the record for
    // readers that treat CR as a line terminator.
    const csv = toCsvString([{ memo: "line1\rline2" }], [
      { key: "memo", header: "Memo" },
    ]);
    expect(csv).toContain('"line1\rline2"');
  });

  it("quotes fields containing a newline", () => {
    const csv = toCsvString([{ memo: "a\nb" }], [
      { key: "memo", header: "Memo" },
    ]);
    expect(csv).toContain('"a\nb"');
  });

  it("doubles embedded quotes", () => {
    const csv = toCsvString([{ memo: 'say "hi"' }], [
      { key: "memo", header: "Memo" },
    ]);
    expect(csv).toContain('"say ""hi"""');
  });

  it("leaves ordinary values unquoted", () => {
    const csv = toCsvString([{ memo: "plain" }], [
      { key: "memo", header: "Memo" },
    ]);
    expect(csv.split("\n")[1]).toBe("plain");
  });

  it("round-trips a realistic payment row", () => {
    const csv = toCsvString(
      [
        toExportRow({
          id: "pay_1",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
          status: "COMPLETED",
          amount: { toString: () => "10.0000000" },
          assetCode: "XLM",
          memo: "invoice, #42",
          transactionHash: "abc123",
        }),
      ],
      exportColumnSpec()
    );
    const row = csv.split("\n")[1];
    expect(row).toContain("pay_1");
    expect(row).toContain('"invoice, #42"');
    expect(row).toContain("abc123");
  });
});

// ─── Response headers ───────────────────────────────────────────

describe("createCsvResponse", () => {
  it("attaches export metadata headers when provided", () => {
    const res = createCsvResponse("x.csv", "a\n1", {
      "X-Export-Row-Count": "1",
      "X-Export-Truncated": "false",
    });
    expect(res.headers.get("X-Export-Row-Count")).toBe("1");
    expect(res.headers.get("X-Export-Truncated")).toBe("false");
  });

  it("still sets the CSV content type and filename without extra headers", () => {
    const res = createCsvResponse("x.csv", "a\n1");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("x.csv");
  });
});
