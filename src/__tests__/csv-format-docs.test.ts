// SPDX-License-Identifier: MIT
//
// Keeps docs/CSV_FORMAT.md honest: the sample file and every error message
// documented there must match what the real parser and validator produce.
// If the CSV format ever changes, this test fails until the docs are
// updated too.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRecipientsCsv } from "@/lib/csv-import";
import { validateBatchRecipients } from "@/lib/batch-validator";

// Vitest runs from the project root, so cwd() is the repo root.
const PROJECT_ROOT = process.cwd();

function csvFile(content: string): File {
  return new File([content], "batch.csv", { type: "text/csv" });
}

const VALID_ADDRESS_A = "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4";
const VALID_ADDRESS_B = "G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3";

describe("docs/CSV_FORMAT.md — sample file", () => {
  it("parses the documented sample file into the expected recipients", async () => {
    const sample = readFileSync(
      resolve(PROJECT_ROOT, "docs/samples/batch-payments.csv"),
      "utf8"
    );

    const { recipients, errors } = await parseRecipientsCsv(csvFile(sample));

    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(3);
    expect(recipients[0]).toMatchObject({
      address: VALID_ADDRESS_A,
      amount: 100,
      assetCode: "XLM",
      memo: "September payout",
    });
    expect(recipients[1]).toMatchObject({
      address: VALID_ADDRESS_B,
      amount: 25.5,
      assetCode: "XLM",
      memo: undefined,
    });
    expect(recipients[2]).toMatchObject({
      assetCode: "USDC",
      memo: "gas fee refund",
    });
  });

  it("keeps the inline sample in CSV_FORMAT.md in sync with the sample file", async () => {
    const doc = readFileSync(
      resolve(PROJECT_ROOT, "docs/CSV_FORMAT.md"),
      "utf8"
    );
    const sample = readFileSync(
      resolve(PROJECT_ROOT, "docs/samples/batch-payments.csv"),
      "utf8"
    ).trim();

    const codeBlock = doc.match(/```csv\n([\s\S]*?)```/);
    expect(codeBlock).not.toBeNull();
    expect(codeBlock![1].trim()).toBe(sample);
  });
});

describe("docs/CSV_FORMAT.md — documented import errors", () => {
  it("rejects a file with only a header row", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile("address,amount,assetCode,memo\n")
    );

    expect(recipients).toEqual([]);
    expect(errors).toEqual([
      { row: 0, message: "CSV must have a header row and at least one data row." },
    ]);
  });

  it("rejects a row missing address and amount", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile("address,amount,assetCode,memo\nonly-an-address\n")
    );

    expect(recipients).toEqual([]);
    expect(errors).toEqual([
      { row: 2, message: "Each row must have at least address and amount." },
    ]);
  });

  it("rejects an invalid Stellar address with the documented message", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS_A.toLowerCase()},100,XLM,\n`)
    );

    expect(recipients).toEqual([]);
    expect(errors).toEqual([
      { row: 2, message: "Invalid Stellar address at row 2." },
    ]);
  });

  it("rejects a non-positive amount with the documented message", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(`address,amount,assetCode,memo\n${VALID_ADDRESS_A},0,XLM,\n`)
    );

    expect(recipients).toEqual([]);
    expect(errors).toEqual([{ row: 2, message: "Invalid amount at row 2." }]);
  });

  it("continues parsing subsequent rows after an error row", async () => {
    const { recipients, errors } = await parseRecipientsCsv(
      csvFile(
        `address,amount,assetCode,memo\nnot-an-address,100,XLM,\n${VALID_ADDRESS_A},50,XLM,ok\n`
      )
    );

    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(VALID_ADDRESS_A);
    expect(errors).toEqual([
      { row: 2, message: "Invalid Stellar address at row 2." },
    ]);
  });
});

describe("docs/CSV_FORMAT.md — documented validator errors", () => {
  it("requires at least one recipient", () => {
    const result = validateBatchRecipients([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { index: -1, field: "recipients", message: "At least one recipient is required." },
    ]);
  });

  it("caps batches at 100 recipients", () => {
    const recipients = Array.from({ length: 101 }, () => ({
      address: `${VALID_ADDRESS_A}`,
      amount: 1,
    }));
    const result = validateBatchRecipients(recipients);
    expect(result.errors).toContainEqual({
      index: -1,
      field: "recipients",
      message: "Maximum 100 recipients per batch.",
    });
  });

  it("rejects duplicate addresses", () => {
    const result = validateBatchRecipients([
      { address: VALID_ADDRESS_A, amount: 1 },
      { address: VALID_ADDRESS_A, amount: 2 },
    ]);
    expect(result.errors).toContainEqual({
      index: 1,
      field: "address",
      message: "Duplicate address.",
    });
  });

  it("rejects non-positive amounts", () => {
    const result = validateBatchRecipients([
      { address: VALID_ADDRESS_A, amount: 0 },
    ]);
    expect(result.errors).toContainEqual({
      index: 0,
      field: "amount",
      message: "Amount must be greater than 0.",
    });
  });

  it("flags a total exceeding the available balance", () => {
    const result = validateBatchRecipients(
      [{ address: VALID_ADDRESS_A, amount: 60 }],
      50
    );
    expect(result.errors).toContainEqual({
      index: -1,
      field: "total",
      message: "Total of 60 exceeds available balance of 50.",
    });
  });
});
