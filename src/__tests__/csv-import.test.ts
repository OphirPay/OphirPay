// SPDX-License-Identifier: MIT
// Unit tests for CSV batch parser (malformed rows, encodings, headers, quotes, extra columns)

import { describe, it, expect } from "vitest";
import {
  parseRecipientsCsv,
  parseRecipientsCsvText,
  splitCsvRow,
  generateRecipientsCsvTemplate,
} from "@/lib/csv-import";

const VALID_ADDR_1 = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2CTRBIAP2W2QASXYZW1";
const VALID_ADDR_2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_ADDR_3 = "GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGHD7UAKFD75JILZBCA3QW6";

function csvFile(content: string, name = "recipients.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("CSV Batch Parser - Unit Tests", () => {
  describe("splitCsvRow utility", () => {
    it("splits plain comma-separated values", () => {
      const result = splitCsvRow("val1,val2,val3");
      expect(result).toEqual(["val1", "val2", "val3"]);
    });

    it("handles commas inside quoted strings", () => {
      const result = splitCsvRow(`${VALID_ADDR_1},100,XLM,"Payment for design, development, and QA"`);
      expect(result).toEqual([
        VALID_ADDR_1,
        "100",
        "XLM",
        "Payment for design, development, and QA",
      ]);
    });

    it("handles escaped double quotes inside quoted strings", () => {
      const result = splitCsvRow(`${VALID_ADDR_1},50,USDC,"Invoice #""1024"" - July"`);
      expect(result).toEqual([
        VALID_ADDR_1,
        "50",
        "USDC",
        'Invoice #"1024" - July',
      ]);
    });
  });

  describe("Happy Path & Fixture", () => {
    it("successfully parses a standard multi-recipient CSV fixture", async () => {
      const csvContent = [
        "address,amount,assetCode,memo",
        `${VALID_ADDR_1},100.50,XLM,Salary Aug`,
        `${VALID_ADDR_2},250.00,USDC,Bonus 2026`,
        `${VALID_ADDR_3},15.75,EURC,Reimbursement`,
      ].join("\n");

      const { recipients, errors } = await parseRecipientsCsv(csvFile(csvContent));

      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(3);
      expect(recipients[0]).toEqual({
        address: VALID_ADDR_1,
        amount: 100.5,
        assetCode: "XLM",
        memo: "Salary Aug",
      });
      expect(recipients[1]).toEqual({
        address: VALID_ADDR_2,
        amount: 250,
        assetCode: "USDC",
        memo: "Bonus 2026",
      });
      expect(recipients[2]).toEqual({
        address: VALID_ADDR_3,
        amount: 15.75,
        assetCode: "EURC",
        memo: "Reimbursement",
      });
    });

    it("works with generateRecipientsCsvTemplate output", () => {
      const template = generateRecipientsCsvTemplate();
      const { recipients, errors } = parseRecipientsCsvText(template);

      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(1);
      expect(recipients[0].address).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
      expect(recipients[0].amount).toBe(100);
      expect(recipients[0].assetCode).toBe("XLM");
    });
  });

  describe("Encoding, BOM & Line Endings", () => {
    it("strips UTF-8 Byte Order Mark (BOM: \\uFEFF) at start of file", async () => {
      const csvWithBom = `\uFEFFaddress,amount,assetCode,memo\n${VALID_ADDR_1},100,XLM,test\n`;
      const { recipients, errors } = await parseRecipientsCsv(csvFile(csvWithBom));

      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(1);
      expect(recipients[0].address).toBe(VALID_ADDR_1);
    });

    it("handles Windows CRLF (\\r\\n) and classic Mac CR (\\r) line endings", () => {
      const crlfCsv = `address,amount,assetCode,memo\r\n${VALID_ADDR_1},100,XLM,crlf\r\n${VALID_ADDR_2},200,USDC,crlf2\r\n`;
      const resultCrlf = parseRecipientsCsvText(crlfCsv);
      expect(resultCrlf.errors).toHaveLength(0);
      expect(resultCrlf.recipients).toHaveLength(2);

      const crCsv = `address,amount\r${VALID_ADDR_1},50\r${VALID_ADDR_2},60\r`;
      const resultCr = parseRecipientsCsvText(crCsv);
      expect(resultCr.errors).toHaveLength(0);
      expect(resultCr.recipients).toHaveLength(2);
    });

    it("handles UTF-8 multi-byte characters in memo field without crashing", () => {
      const unicodeCsv = [
        "address,amount,assetCode,memo",
        `${VALID_ADDR_1},100,XLM,Tiền thưởng quý 3 🚀`,
        `${VALID_ADDR_2},200,USDC,Café & bánh ngọt ☕🍰`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(unicodeCsv);
      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(2);
      expect(recipients[0].memo).toBe("Tiền thưởng quý 3 🚀");
      expect(recipients[1].memo).toBe("Café & bánh ngọt ☕🍰");
    });
  });

  describe("Header Parsing & Flexible Column Ordering", () => {
    it("supports custom header column names (recipient, value, currency, note)", () => {
      const csv = [
        "recipient,value,currency,note",
        `${VALID_ADDR_1},500,USDC,Contract payment`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(1);
      expect(recipients[0].address).toBe(VALID_ADDR_1);
      expect(recipients[0].amount).toBe(500);
      expect(recipients[0].assetCode).toBe("USDC");
      expect(recipients[0].memo).toBe("Contract payment");
    });

    it("supports reordered header columns (amount, address, memo, assetCode)", () => {
      const csv = [
        "amount,address,memo,assetCode",
        `45.5,${VALID_ADDR_1},Order #99,XLM`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(1);
      expect(recipients[0].address).toBe(VALID_ADDR_1);
      expect(recipients[0].amount).toBe(45.5);
      expect(recipients[0].memo).toBe("Order #99");
      expect(recipients[0].assetCode).toBe("XLM");
    });

    it("handles extra unused columns gracefully", () => {
      const csv = [
        "address,amount,assetCode,memo,department,timestamp,notes_internal",
        `${VALID_ADDR_1},100,XLM,Bonus,Engineering,2026-08-29,Approved by Lead`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(errors).toHaveLength(0);
      expect(recipients).toHaveLength(1);
      expect(recipients[0].address).toBe(VALID_ADDR_1);
      expect(recipients[0].amount).toBe(100);
      expect(recipients[0].memo).toBe("Bonus");
    });
  });

  describe("Malformed Rows & Error Reporting with Line Numbers", () => {
    it("reports row-level error with line number for invalid Stellar address", () => {
      const csv = [
        "address,amount,assetCode,memo",
        `${VALID_ADDR_1},100,XLM,valid row 2`,
        `INVALID_STELLAR_ADDR_123,50,XLM,invalid row 3`,
        `${VALID_ADDR_2},200,XLM,valid row 4`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(recipients).toHaveLength(2);
      expect(errors).toHaveLength(1);
      expect(errors[0].row).toBe(3);
      expect(errors[0].message).toContain("Row 3");
      expect(errors[0].message).toContain("Invalid Stellar address");
    });

    it("reports row-level error with line number for missing or negative amounts", () => {
      const csv = [
        "address,amount,assetCode,memo",
        `${VALID_ADDR_1},-50,XLM,negative amount row 2`,
        `${VALID_ADDR_2},0,XLM,zero amount row 3`,
        `${VALID_ADDR_3},NOT_A_NUMBER,XLM,nan amount row 4`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(recipients).toHaveLength(0);
      expect(errors).toHaveLength(3);
      expect(errors[0].row).toBe(2);
      expect(errors[0].message).toContain("Row 2: Invalid amount");
      expect(errors[1].row).toBe(3);
      expect(errors[1].message).toContain("Row 3: Invalid amount");
      expect(errors[2].row).toBe(4);
      expect(errors[2].message).toContain("Row 4: Invalid amount");
    });

    it("reports row-level error for rows with insufficient columns (< 2)", () => {
      const csv = [
        "address,amount,assetCode,memo",
        `${VALID_ADDR_1}`,
        `${VALID_ADDR_2},100`,
      ].join("\n");

      const { recipients, errors } = parseRecipientsCsvText(csv);
      expect(recipients).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].row).toBe(2);
      expect(errors[0].message).toContain("Row 2: Each row must have at least address and amount");
    });

    it("never throws an unhandled exception on random garbage input or empty files", async () => {
      expect(() => parseRecipientsCsvText("")).not.toThrow();
      expect(() => parseRecipientsCsvText("     \n\n  \n")).not.toThrow();
      expect(() => parseRecipientsCsvText(";;;$$$%%%^^^")).not.toThrow();
      expect(() => parseRecipientsCsvText(null as unknown as string)).not.toThrow();

      const emptyRes = parseRecipientsCsvText("");
      expect(emptyRes.errors).toHaveLength(1);
      expect(emptyRes.errors[0].message).toContain("empty");

      const headerOnlyRes = parseRecipientsCsvText("address,amount,assetCode\n");
      expect(headerOnlyRes.errors).toHaveLength(1);
      expect(headerOnlyRes.errors[0].message).toContain("header row and at least one data row");
    });
  });
});
