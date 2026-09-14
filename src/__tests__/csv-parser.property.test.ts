import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsvText } from "@/lib/csv-import";

function emitCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => /[",\r\n]/.test(cell) || cell.includes('"')
          ? `"${cell.replace(/"/g, '""')}"`
          : cell)
        .join(","),
    )
    .join("\r\n");
}

const csvCell = fc.string({ unit: fc.constantFrom(",", '"', "\r", "\n", "a", "7", " ") });
const csvRow = fc.array(csvCell, { minLength: 1, maxLength: 6 }).filter((row) =>
  row.some((cell) => cell.length > 0),
);

describe("parseCsvText RFC-4180 property coverage", () => {
  it("round-trips quoted commas, newlines, and escaped quotes", () => {
    fc.assert(
      fc.property(fc.array(csvRow, { minLength: 1, maxLength: 12 }), (rows) => {
        expect(parseCsvText(emitCsv(rows))).toEqual(rows);
      }),
      { numRuns: 200 },
    );
  });
});
