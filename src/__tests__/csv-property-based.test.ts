// SPDX-License-Identifier: MIT
// Property-based-style tests for csv-import.ts parseCsvText
// Covers RFC-4180 edge cases: quoting, commas, newlines, escaped quotes.

import { describe, it, expect } from "vitest";
import { parseCsvText } from "@/lib/csv-import";

/**
 * Serialize a cell matrix back to CSV text.
 * Mirrors the escaping rules in parseCsvText so we can test round-trips.
 */
function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(",") || cell.includes('"') || cell.includes("\n") || cell.includes("\r")) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(",")
    )
    .join("\n");
}

/**
 * Assert that parsing a CSV text and re-serializing it yields the same
 * cell matrix. This is the core property we want to hold.
 */
function assertRoundTrip(rows: string[][]) {
  const csv = serializeCsv(rows);
  const parsed = parseCsvText(csv);
  // Filter out empty rows that parseCsvText drops
  const nonEmptyParsed = parsed.filter((r) => r.some((c) => c !== ""));
  expect(nonEmptyParsed).toEqual(rows);
}

describe("csv-import > parseCsvText property-based round-trips", () => {
  it("round-trips plain ASCII rows", () => {
    assertRoundTrip([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("round-trips cells containing commas", () => {
    assertRoundTrip([
      ["hello, world", "foo"],
      ["a,b,c", "d"],
    ]);
  });

  it("round-trips cells containing quotes", () => {
    assertRoundTrip([
      ['say "hello"', "foo"],
      ['"quoted"', "bar"],
    ]);
  });

  it("round-trips cells containing escaped quotes", () => {
    assertRoundTrip([
      ['""', "foo"],
      ['say ""hello""', "bar"],
    ]);
  });

  it("round-trips cells containing newlines", () => {
    assertRoundTrip([
      ["line1\nline2", "foo"],
      ["a", "b\nc"],
    ]);
  });

  it("round-trips cells containing CRLF", () => {
    assertRoundTrip([
      ["line1\r\nline2", "foo"],
    ]);
  });

  it("round-trips cells containing mixed special chars", () => {
    assertRoundTrip([
      ["a, \"b\", c\nline", "foo"],
      ["x", "y, \"z\"\nnext"],
    ]);
  });

  it("round-trips empty cells", () => {
    assertRoundTrip([
      ["", "a", ""],
      ["b", "", "c"],
    ]);
  });

  it("round-trips single-column rows", () => {
    assertRoundTrip([["a"], ["b,c"], ['c"d'], ["e\nf"]]);
  });

  it("round-trips Unicode content", () => {
    assertRoundTrip([
      ["日本語", "中文"],
      ["🎉", "émojis"],
    ]);
  });

  it("round-trips cells that look like numbers", () => {
    assertRoundTrip([
      ["100", "200.50"],
      ["001", "0"],
    ]);
  });

  it("round-trips rows with varying column counts", () => {
    assertRoundTrip([
      ["a", "b"],
      ["c", "d", "e"],
      ["f"],
    ]);
  });

  it("handles a single row without trailing newline", () => {
    const rows = [["a", "b", "c"]];
    const csv = serializeCsv(rows); // no trailing newline
    const parsed = parseCsvText(csv);
    expect(parsed).toEqual(rows);
  });

  it("handles a single empty row (dropped by filter)", () => {
    const csv = ",";
    const parsed = parseCsvText(csv);
    // Two empty cells => row is dropped by parseCsvText filter
    expect(parsed).toEqual([]);
  });

  it("round-trips a realistic header + data pattern", () => {
    assertRoundTrip([
      ["address", "amount", "memo"],
      ["GABC123", "100", "hello"],
      ["GDEF456", "200", "thanks"],
    ]);
  });

  it("round-trips memos with commas and quotes", () => {
    assertRoundTrip([
      ["address", "amount", "memo"],
      ["GABC", "100", "for services, inc."],
      ["GDEF", "200", 'say "thanks"'],
    ]);
  });

  it("handles deeply nested quotes", () => {
    assertRoundTrip([["\"\"\"\"", "x"]]);
  });

  it("handles a cell that is just a comma inside quotes", () => {
    assertRoundTrip([[",", "x"]]);
  });

  it("handles a cell that is just a newline inside quotes", () => {
    assertRoundTrip([["\n", "x"]]);
  });

  it("handles many columns", () => {
    assertRoundTrip([Array.from({ length: 50 }, (_, i) => `col${i}`)]);
  });
});

describe("csv-import > parseCsvText edge cases", () => {
  it("strips a leading BOM", () => {
    const parsed = parseCsvText("\uFEFFa,b\n1,2");
    expect(parsed[0]).toEqual(["a", "b"]);
    expect(parsed[1]).toEqual(["1", "2"]);
  });

  it("normalizes CRLF to LF internally", () => {
    const parsed = parseCsvText("a,b\r\nc,d");
    expect(parsed).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles lone CR", () => {
    const parsed = parseCsvText("a,b\rc,d");
    expect(parsed).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops entirely blank rows", () => {
    const parsed = parseCsvText("a,b\n\n\nc,d");
    expect(parsed).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles consecutive commas (empty cells) interspersed with data", () => {
    const parsed = parseCsvText("a,,b\nc,d");
    expect(parsed).toEqual([
      ["a", "", "b"],
      ["c", "d"],
    ]);
  });

  it("handles a quoted field ending at EOF", () => {
    const parsed = parseCsvText('a,"b"');
    expect(parsed).toEqual([["a", "b"]]);
  });

  it("handles an unclosed quote (treats rest of file as quoted)", () => {
    const parsed = parseCsvText('a,"b');
    expect(parsed).toEqual([["a", "b"]]);
  });

  it("handles a cell containing only escaped quotes", () => {
    const parsed = parseCsvText('""""');
    expect(parsed).toEqual([[String.fromCharCode(34)]]);
  });

  it("handles mixed CRLF and LF in the same file", () => {
    const parsed = parseCsvText("a,b\r\nc,d\ne,f");
    expect(parsed).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });
});
