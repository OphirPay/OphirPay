// SPDX-License-Identifier: MIT
// Unit tests for the CSV batch parser focused on malformed rows, encodings, and headers.

import { describe, it, expect } from "vitest";
import {
  parseCsvText,
  parseRecipientsCsvToRows,
} from "@/lib/csv-import";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function csvFile(content: string): File {
  return new File([content], "recipients.csv", { type: "text/csv" });
}

describe("csv-batch-parser > parseCsvText", () => {
  it("strips a leading UTF-8 BOM", () => {
    const rows = parseCsvText(`\uFEFFaddress,amount\n${VALID_ADDRESS},100\n`);
    expect(rows[0]).toEqual(["address", "amount"]);
    expect(rows[1]).toEqual([VALID_ADDRESS, "100"]);
  });

  it("handles CRLF line endings", () => {
    const rows = parseCsvText(
      `address,amount\r\n${VALID_ADDRESS},100\r\n`
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([VALID_ADDRESS, "100"]);
  });

  it("handles lone CR line endings", () => {
    const rows = parseCsvText(
      `address,amount\r${VALID_ADDRESS},100\r`
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([VALID_ADDRESS, "100"]);
  });

  it("parses quoted fields containing commas and newlines", () => {
    const rows = parseCsvText(
      `address,memo\n"${VALID_ADDRESS}","multi\nline, memo"\n`
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([VALID_ADDRESS, "multi\nline, memo"]);
  });

  it("parses escaped quotes ("") inside quoted fields", () => {
    const rows = parseCsvText(
      `address,memo\n"${VALID_ADDRESS}","""quoted"" memo"\n`
    );
    expect(rows[1]).toEqual([VALID_ADDRESS, '"quoted" memo']);
  });

  it("does not require a trailing newline", () => {
    const rows = parseCsvText(`address,amount\n${VALID_ADDRESS},100`);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([VALID_ADDRESS, "100"]);
  });

  it("drops rows that are entirely blank", () => {
    const rows = parseCsvText(
      `address,amount\n${VALID_ADDRESS},100\n,,\n   ,   \n${OTHER_ADDRESS},200\n`
    );
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual([OTHER_ADDRESS, "200"]);
  });

  it("returns a single-row header when given only a header", () => {
    const rows = parseCsvText(`address,amount`);
    expect(rows).toEqual([["address", "amount"]]);
  });
});

describe("csv-batch-parser > parseRecipientsCsvToRows", () => {
  it("reads columns by header name when present", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`amount,address,memo\n100,${VALID_ADDRESS},hi\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({ address: VALID_ADDRESS, amount: "100", memo: "hi" });
  });

  it("falls back to positional columns 1-3 when headers are missing", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`${VALID_ADDRESS},100,hi\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].values).toEqual({ address: VALID_ADDRESS, amount: "100", memo: "hi" });
  });

  it("ignores the legacy assetCode column in a 4-column template", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS},100,USDC,legacy\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].values).toEqual({ address: VALID_ADDRESS, amount: "100", memo: "legacy" });
  });

  it("reports a file error when there is no data row", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount\n`)
    );
    expect(rows).toEqual([]);
    expect(fileErrors).toHaveLength(1);
    expect(fileErrors[0]).toContain("header row");
  });

  it("reports a file error when there are more than 100 data rows", async () => {
    const data = Array.from({ length: 101 }, (_, i) =>
      `${VALID_ADDRESS.replace(/A$/, "")}${String(i).padStart(2, "0")},1`
    ).join("\n");
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount\n${data}\n`)
    );
    expect(fileErrors).toHaveLength(1);
    expect(fileErrors[0]).toContain("100");
  });

  it("marks duplicate valid addresses after the first occurrence", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount\n${VALID_ADDRESS},100\n${VALID_ADDRESS},200\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].errors.address).toBeUndefined();
    expect(rows[1].errors.address).toContain("Duplicate");
  });

  it("marks malformed rows with per-field errors", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount\nBAD_ADDRESS,not-a-number\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].errors.address).toContain("Invalid");
    expect(rows[0].errors.amount).toContain("number");
  });

  it("preserves non-ASCII UTF-8 memo content", async () => {
    const { rows, fileErrors } = await parseRecipientsCsvToRows(
      csvFile(`address,amount,memo\n${VALID_ADDRESS},100,中文 🚀\n`)
    );
    expect(fileErrors).toEqual([]);
    expect(rows[0].values.memo).toBe("中文 🚀");
  });
});
