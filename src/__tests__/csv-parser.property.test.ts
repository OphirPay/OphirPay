// SPDX-License-Identifier: MIT
//
// Property coverage for the shared CSV core (issue #761).
//
// The parser and serializer used to be implemented per call site, so the
// property tests only guarded whichever module they targeted. They now run
// against `@/lib/csv/core`, which every call site funnels through, and pin the
// acceptance-criteria round-trip of a field containing a comma, a quote and a
// CRLF.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsv, serializeCsv } from "@/lib/csv/core";
import { parseCsvText } from "@/lib/csv-import";

const csvCell = fc.string({ unit: fc.constantFrom(",", '"', "\r", "\n", "a", "7", " ") });
const csvRow = fc.array(csvCell, { minLength: 1, maxLength: 6 }).filter((row) =>
  row.some((cell) => cell.length > 0),
);

describe("csv core RFC-4180 property coverage (#761)", () => {
  it("round-trips quoted commas, newlines, and escaped quotes with LF", () => {
    fc.assert(
      fc.property(fc.array(csvRow, { minLength: 1, maxLength: 12 }), (rows) => {
        expect(parseCsv(serializeCsv(rows, { eol: "\n" }))).toEqual(rows);
      }),
      { numRuns: 200 },
    );
  });

  it("round-trips with CRLF line endings", () => {
    fc.assert(
      fc.property(fc.array(csvRow, { minLength: 1, maxLength: 12 }), (rows) => {
        expect(parseCsv(serializeCsv(rows, { eol: "\r\n" }))).toEqual(rows);
      }),
      { numRuns: 150 },
    );
  });

  it("round-trips a field containing a comma, a quote and a CRLF", () => {
    const rows = [
      ["address", "amount", "memo"],
      ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "10", 'a,b "c"\r\nd'],
    ];
    const text = serializeCsv(rows, { eol: "\r\n" });
    // Serializer quotes the field; parser restores it byte-for-byte.
    expect(text).toContain('"a,b ""c""\r\nd"');
    expect(parseCsv(text)).toEqual(rows);
  });

  it("parseCsvText (csv-import) delegates to the shared parser", () => {
    fc.assert(
      fc.property(fc.array(csvRow, { minLength: 1, maxLength: 8 }), (rows) => {
        const text = serializeCsv(rows, { eol: "\n" });
        expect(parseCsvText(text)).toEqual(parseCsv(text));
      }),
      { numRuns: 100 },
    );
  });

  it("strips a leading UTF-8 BOM on both paths", () => {
    const text = serializeCsv([["a", "b"]], { eol: "\n" });
    expect(parseCsv(`\uFEFF${text}`)).toEqual([["a", "b"]]);
    expect(parseCsvText(`\uFEFF${text}`)).toEqual([["a", "b"]]);
  });
});
