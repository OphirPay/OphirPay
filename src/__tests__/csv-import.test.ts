// SPDX-License-Identifier: MIT
// Tests for csv-import.ts parseRecipientsCsv — BOM, line endings, and edge cases

import { describe, it, expect } from "vitest";
import { parseRecipientsCsv } from "@/lib/csv-import";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function csvFile(content: string): File {
  return new File([content], "recipients.csv", { type: "text/csv" });
}

describe("csv-import > parseRecipientsCsv", () => {
  it("parses a plain UTF-8 CSV with header and one data row", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,thanks\n`
      )
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS);
    expect(recipients[0].amount).toBe(100);
    expect(recipients[0].assetCode).toBe("XLM");
    expect(recipients[0].memo).toBe("thanks");
  });

  it("strips a leading UTF-8 BOM (U+FEFF) from Excel exports", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `\uFEFFaddress,amount,assetCode,memo\n${VALID_ADDRESS},100,XLM,thanks\n`
      )
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS);
  });

  it("normalizes Windows CRLF line endings", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\r\n${VALID_ADDRESS},100,XLM,thanks\r\n`
      )
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].memo).toBe("thanks");
  });

  it("handles a BOM combined with CRLF line endings", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `\uFEFFaddress,amount,assetCode,memo\r\n${VALID_ADDRESS},250,USDC,payroll\r\n`
      )
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].amount).toBe(250);
    expect(recipients[0].assetCode).toBe("USDC");
    expect(recipients[0].memo).toBe("payroll");
  });

  it("defaults assetCode to XLM and memo to undefined when omitted", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount\n${VALID_ADDRESS},50\n`)
    );

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].assetCode).toBe("XLM");
    expect(recipients[0].memo).toBeUndefined();
  });

  it("trims surrounding whitespace on address and amount columns", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\n ${VALID_ADDRESS} , 75 , XLM , hi\n`
      )
    );

    expect(errors).toEqual([]);
    expect(recipients[0].address).toBe(VALID_ADDRESS);
    expect(recipients[0].amount).toBe(75);
  });

  it("reports an invalid address as an error and skips the row", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount\nNOT_AN_ADDRESS,100\n${VALID_ADDRESS},200\n`)
    );

    expect(recipients).toHaveLength(1);
    expect(recipients[0].amount).toBe(200);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain("Invalid Stellar address");
  });

  it("rejects a CSV with only a header row", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile("address,amount,assetCode,memo\n")
    );

    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("header row");
  });

  it("rejects an empty file", async () => {
    const { recipients, errors } = await parseRecipientsCsv(csvFile(""));

    expect(recipients).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("header row");
  });
});