// SPDX-License-Identifier: MIT
// Tests for the batch CSV import flow: robust parsing and field-level validation.

import { describe, it, expect } from "vitest";
import {
  parseCsvText,
  validateRecipientFields,
  parseRecipientsCsvToRows,
  applyDuplicateErrors,
  MAX_BATCH_RECIPIENTS,
  type CsvImportRow,
} from "@/lib/csv-import";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "G" + "B".repeat(55);

function csvFile(content: string): File {
  return new File([content], "recipients.csv", { type: "text/csv" });
}

// ── parseCsvText ──────────────────────────────────────────────

describe("csv-import-flow > parseCsvText", () => {
  it("parses simple comma-separated rows", () => {
    expect(parseCsvText("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsvText('a,"b,c",d\n')).toEqual([["a", "b,c", "d"]]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsvText('a,"say ""hi""",d\n')).toEqual([
      ["a", 'say "hi"', "d"],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsvText('a,"line1\nline2",d\n')).toEqual([
      ["a", "line1\nline2", "d"],
    ]);
  });

  it("normalizes CRLF and lone CR line endings", () => {
    expect(parseCsvText("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsvText("a,b\rc,d\r")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsvText("\uFEFFa,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops blank lines and does not emit a trailing empty row", () => {
    expect(parseCsvText("a,b\n\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsvText("a,b\n")).toEqual([["a", "b"]]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsvText("")).toEqual([]);
  });
});

// ── validateRecipientFields ───────────────────────────────────

describe("csv-import-flow > validateRecipientFields", () => {
  it("returns no errors for a valid row", () => {
    expect(
      validateRecipientFields(VALID_ADDRESS, "100", "thanks")
    ).toEqual({});
  });

  it("flags a missing address", () => {
    expect(validateRecipientFields("", "100", "").address).toMatch(
      /required/i
    );
  });

  it("flags an invalid address", () => {
    expect(validateRecipientFields("NOT_AN_ADDRESS", "100", "").address).toMatch(
      /invalid/i
    );
  });

  it("flags sending to your own address", () => {
    expect(
      validateRecipientFields(VALID_ADDRESS, "100", "", {
        selfAddress: VALID_ADDRESS,
      }).address
    ).toMatch(/own address/i);
  });

  it("flags a missing amount", () => {
    expect(validateRecipientFields(VALID_ADDRESS, "", "").amount).toMatch(
      /required/i
    );
  });

  it("flags non-positive or non-numeric amounts", () => {
    expect(
      validateRecipientFields(VALID_ADDRESS, "0", "").amount
    ).toMatch(/greater than 0/i);
    expect(
      validateRecipientFields(VALID_ADDRESS, "-5", "").amount
    ).toMatch(/greater than 0/i);
    expect(
      validateRecipientFields(VALID_ADDRESS, "abc", "").amount
    ).toMatch(/greater than 0/i);
  });

  it("flags memos longer than 28 characters", () => {
    expect(
      validateRecipientFields(VALID_ADDRESS, "1", "x".repeat(29)).memo
    ).toMatch(/28 characters/i);
    expect(
      validateRecipientFields(VALID_ADDRESS, "1", "x".repeat(28)).memo
    ).toBeUndefined();
  });

  it("collects multiple field errors on one row", () => {
    const errors = validateRecipientFields("bad", "nope", "x".repeat(40));
    expect(errors.address).toBeDefined();
    expect(errors.amount).toBeDefined();
    expect(errors.memo).toBeDefined();
  });
});

// ── parseRecipientsCsvToRows ──────────────────────────────────

describe("csv-import-flow > parseRecipientsCsvToRows", () => {
  it("parses a valid file into error-free rows", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,thanks\n${OTHER_ADDRESS},50,\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => Object.keys(r.errors).length === 0)).toBe(true);
    expect(rows[0].values).toEqual({
      address: VALID_ADDRESS,
      amount: "100",
      memo: "thanks",
    });
    expect(rows[1].sourceRow).toBe(2);
  });

  it("reads memo from the legacy 4-column template, ignoring assetCode", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,payroll\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].values.memo).toBe("payroll");
    expect(rows[0].values.amount).toBe("100");
  });

  it("flags malformed rows with the offending field", async () => {
    const { rows } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\nNOT_AN_ADDRESS,100,hi\n${VALID_ADDRESS},0,short\n`)
    );
    expect(rows[0].errors.address).toMatch(/invalid/i);
    expect(rows[0].errors.amount).toBeUndefined();
    expect(rows[1].errors.amount).toMatch(/greater than 0/i);
    expect(rows[1].errors.address).toBeUndefined();
  });

  it("flags duplicate addresses on every occurrence after the first", async () => {
    const { rows } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n${OTHER_ADDRESS},50,\n${VALID_ADDRESS},25,\n`)
    );
    expect(rows[0].errors.address).toBeUndefined();
    expect(rows[1].errors.address).toBeUndefined();
    expect(rows[2].errors.address).toMatch(/duplicate/i);
  });

  it("flags rows sending to the self address", async () => {
    const { rows } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,\n`),
      { selfAddress: VALID_ADDRESS }
    );
    expect(rows[0].errors.address).toMatch(/own address/i);
  });

  it("reports a file error when there is no data row", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile("address,amount,memo\n")
    );
    expect(rows).toEqual([]);
    expect(fileErrors).toHaveLength(1);
    expect(fileErrors[0]).toMatch(/header row/i);
  });

  it("reports a file error when the batch exceeds the recipient limit", async () => {
    const lines = ["address,amount,memo"];
    for (let i = 0; i < MAX_BATCH_RECIPIENTS + 1; i++) {
      lines.push(`${VALID_ADDRESS},${i + 1},`);
    }
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(lines.join("\n"))
    );
    expect(rows).toHaveLength(MAX_BATCH_RECIPIENTS + 1);
    expect(fileErrors[0]).toMatch(/maximum/i);
  });

  it("trims surrounding whitespace from cells", async () => {
    const { rows } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n ${VALID_ADDRESS} , 75 , hi \n`)
    );
    expect(rows[0].values.address).toBe(VALID_ADDRESS);
    expect(rows[0].values.amount).toBe("75");
    expect(rows[0].values.memo).toBe("hi");
  });
});

// ── applyDuplicateErrors ──────────────────────────────────────

describe("csv-import-flow > applyDuplicateErrors", () => {
  it("clears duplicate errors once duplicates are removed", () => {
    const rows: CsvImportRow[] = [
      { id: 1, sourceRow: 1, values: { address: VALID_ADDRESS, amount: "10", memo: "" }, errors: {} },
      { id: 2, sourceRow: 2, values: { address: VALID_ADDRESS, amount: "20", memo: "" }, errors: { address: "Duplicate address." } },
    ];
    applyDuplicateErrors(rows);
    expect(rows[1].errors.address).toMatch(/duplicate/i);

    applyDuplicateErrors([rows[0]]);
    expect(rows[0].errors.address).toBeUndefined();
  });

  it("leaves rows with an invalid address untouched", () => {
    const rows: CsvImportRow[] = [
      { id: 1, sourceRow: 1, values: { address: "BAD", amount: "10", memo: "" }, errors: { address: "Invalid Stellar address." } },
      { id: 2, sourceRow: 2, values: { address: "BAD", amount: "20", memo: "" }, errors: { address: "Invalid Stellar address." } },
    ];
    applyDuplicateErrors(rows);
    expect(rows[1].errors.address).toMatch(/invalid/i);
  });
});
