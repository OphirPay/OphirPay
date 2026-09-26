// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsv, serializeCsv, serializeRecords, escapeCsvCell } from "@/lib/csv-core";
import { parseCsvText } from "@/lib/csv-import";
import { toCsvString, buildPaymentCsv } from "@/lib/export-csv";

// Arbitrary CSV cell with all challenging RFC-4180 characters: commas, quotes, CRLF, LF, CR, and text
const csvCell = fc.string({ unit: fc.constantFrom(",", '"', "\r", "\n", "a", "7", " ", "\t") });
const csvRow = fc.array(csvCell, { minLength: 1, maxLength: 6 }).filter((row) =>
  row.some((cell) => cell.length > 0)
);

describe("Unified RFC-4180 CSV Core (Issue #761)", () => {
  describe("Property-based bidirectional round-trip coverage", () => {
    it("round-trips arbitrary rows through serializeCsv and parseCsv", () => {
      fc.assert(
        fc.property(fc.array(csvRow, { minLength: 1, maxLength: 12 }), (rows) => {
          const serialized = serializeCsv(rows);
          const parsed = parseCsv(serialized);
          expect(parsed).toEqual(rows);
        }),
        { numRuns: 200 }
      );
    });

    it("round-trips through parseCsvText in csv-import (inherits shared core)", () => {
      fc.assert(
        fc.property(fc.array(csvRow, { minLength: 1, maxLength: 12 }), (rows) => {
          const serialized = serializeCsv(rows);
          const parsed = parseCsvText(serialized);
          expect(parsed).toEqual(rows);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe("Specific Acceptance Criteria", () => {
    it("round-trips a quoted field containing a comma, a quote and a CRLF in both directions", () => {
      // Cell containing a comma, a quote, and a CRLF:
      const trickyField = 'hello, "world"\r\nline2';
      const originalRows = [["header1", "header2"], [trickyField, "normal"]];

      // 1. Serialize -> Parse
      const serialized = serializeCsv(originalRows);
      const parsed = parseCsv(serialized);
      expect(parsed).toEqual(originalRows);
      expect(parsed[1][0]).toBe(trickyField);

      // 2. Parse -> Serialize
      const reSerialized = serializeCsv(parsed);
      expect(reSerialized).toBe(serialized);

      // 3. Raw RFC-4180 string check
      const rawCsv = 'header1,header2\r\n"hello, ""world""\r\nline2",normal';
      const parsedFromRaw = parseCsv(rawCsv);
      expect(parsedFromRaw[1][0]).toBe(trickyField);
      expect(serializeCsv(parsedFromRaw)).toBe(rawCsv);
    });

    it("strips UTF-8 Byte Order Mark (BOM: \\uFEFF) on parse", () => {
      const bomCsv = '\uFEFF"col1",col2\r\nval1,val2';
      const parsed = parseCsv(bomCsv);
      expect(parsed[0][0]).toBe("col1");
      expect(parsed).toEqual([["col1", "col2"], ["val1", "val2"]]);
    });

    it("handles lone LF, lone CR, and CRLF line endings interchangeably", () => {
      const crlf = "a,b\r\nc,d";
      const lf = "a,b\nc,d";
      const cr = "a,b\rc,d";

      expect(parseCsv(crlf)).toEqual([["a", "b"], ["c", "d"]]);
      expect(parseCsv(lf)).toEqual([["a", "b"], ["c", "d"]]);
      expect(parseCsv(cr)).toEqual([["a", "b"], ["c", "d"]]);
    });

    it("drops empty/blank lines while preserving rows with empty string cells in data", () => {
      const csvWithBlanks = "a,b\n\n\n\r\nc,d\n\n";
      expect(parseCsv(csvWithBlanks)).toEqual([["a", "b"], ["c", "d"]]);
    });
  });

  describe("Call-site Integration Coverage", () => {
    it("toCsvString in export-csv round-trips correctly and protects against formula injection", () => {
      const data = [
        { id: "1", memo: "=SUM(A1:A10)", amount: "100.5" },
        { id: "2", memo: 'normal "quoted"', amount: "50" },
      ];
      const columns = [
        { key: "id" as const, header: "ID" },
        { key: "memo" as const, header: "Memo" },
        { key: "amount" as const, header: "Amount" },
      ];

      const csvString = toCsvString(data, columns);
      expect(csvString).toContain("ID,Memo,Amount");
      // Formula prefix guard:
      expect(csvString).toContain("'=SUM(A1:A10)");

      const parsed = parseCsv(csvString);
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toEqual(["ID", "Memo", "Amount"]);
      expect(parsed[1][1]).toBe("'=SUM(A1:A10)");
      expect(parsed[2][1]).toBe('normal "quoted"');
    });

    it("buildPaymentCsv in export-csv generates parseable CSV with headers", () => {
      const payments = [
        {
          id: "pay_1",
          amount: 100,
          currency: "XLM",
          status: "SUCCESS",
          memo: 'test, with comma and "quotes"',
          tx_hash: "hash_abc",
        },
      ];

      const paymentCsv = buildPaymentCsv(payments);
      const parsed = parseCsv(paymentCsv);
      expect(parsed[0]).toEqual(["id", "amount", "currency", "status", "created_at", "memo", "tx_hash"]);
      expect(parsed[1][0]).toBe("pay_1");
      expect(parsed[1][5]).toBe('test, with comma and "quotes"');
      expect(parsed[1][6]).toBe("hash_abc");
    });
  });
});
