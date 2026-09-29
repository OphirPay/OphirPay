// SPDX-License-Identifier: MIT
// Tests for address book CSV import/export: the round trip, partial-failure
// reporting, and the header-only/empty-file messages.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAddressBook,
  saveAddress,
  addressBookToCsv,
  parseAddressBookCsvToRows,
  importAddressBookRows,
  validateAddressBookFields,
  applyDuplicateAddressErrors,
  type AddressBookImportRow,
} from "@/lib/address-book";

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);
const ADDR_C = "G" + "C".repeat(55);

function csvFile(content: string, name = "address-book.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

beforeEach(() => {
  localStorage.clear();
});

describe("validateAddressBookFields", () => {
  it("requires a label and a valid address", () => {
    expect(validateAddressBookFields("", ADDR_A, "")).toEqual({
      label: "Label is required.",
    });
    expect(validateAddressBookFields("Alice", "not-an-address", "")).toEqual({
      address: "Invalid Stellar address.",
    });
    expect(validateAddressBookFields("Alice", ADDR_A, "")).toEqual({});
  });

  it("rejects an overly long label or memo", () => {
    expect(validateAddressBookFields("x".repeat(101), ADDR_A, "")).toEqual({
      label: "Label must be 100 characters or fewer.",
    });
    expect(validateAddressBookFields("Alice", ADDR_A, "x".repeat(29))).toEqual({
      memo: "Memo must be 28 characters or fewer.",
    });
  });
});

describe("applyDuplicateAddressErrors", () => {
  it("flags every repeat of a valid address after the first", () => {
    const rows: AddressBookImportRow[] = [
      { id: 1, sourceRow: 1, values: { label: "Alice", address: ADDR_A, memo: "" }, errors: {} },
      { id: 2, sourceRow: 2, values: { label: "Alice 2", address: ADDR_A, memo: "" }, errors: {} },
    ];
    applyDuplicateAddressErrors(rows);
    expect(rows[0].errors.address).toBeUndefined();
    expect(rows[1].errors.address).toBe("Duplicate address.");
  });
});

describe("parseAddressBookCsvToRows", () => {
  it("reports a clear message for an empty file", async () => {
    const { rows, fileErrors } = await parseAddressBookCsvToRows(csvFile(""));
    expect(rows).toEqual([]);
    expect(fileErrors).toEqual(["CSV file is empty."]);
  });

  it("reports a clear message for a header-only file", async () => {
    const { rows, fileErrors } = await parseAddressBookCsvToRows(
      csvFile("label,address,memo\n")
    );
    expect(rows).toEqual([]);
    expect(fileErrors).toEqual([
      "CSV must have a header row and at least one data row.",
    ]);
  });

  it("keeps valid rows and reports invalid ones with row numbers and reasons", async () => {
    const { rows, fileErrors } = await parseAddressBookCsvToRows(
      csvFile(
        `label,address,memo\nAlice,${ADDR_A},thanks\n,${ADDR_B},\nBob,not-an-address,\nCarl,${ADDR_C},${"x".repeat(29)}\n`
      )
    );

    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toMatchObject({
      sourceRow: 1,
      values: { label: "Alice", address: ADDR_A, memo: "thanks" },
      errors: {},
    });

    expect(rows[1].sourceRow).toBe(2);
    expect(rows[1].errors.label).toBe("Label is required.");

    expect(rows[2].sourceRow).toBe(3);
    expect(rows[2].errors.address).toBe("Invalid Stellar address.");

    expect(rows[3].sourceRow).toBe(4);
    expect(rows[3].errors.memo).toBe("Memo must be 28 characters or fewer.");
  });

  it("supports positional columns when there is no recognized header", async () => {
    const { rows } = await parseAddressBookCsvToRows(
      csvFile(`x,y,z\nAlice,${ADDR_A},hi\n`)
    );
    expect(rows[0].values).toEqual({ label: "Alice", address: ADDR_A, memo: "hi" });
  });

  it("ignores extra columns such as an asset code", async () => {
    const { rows } = await parseAddressBookCsvToRows(
      csvFile(`label,address,memo,asset\nAlice,${ADDR_A},hi,USDC\n`)
    );
    expect(rows[0].values).toEqual({ label: "Alice", address: ADDR_A, memo: "hi" });
    expect(rows[0].errors).toEqual({});
  });
});

describe("importAddressBookRows", () => {
  it("saves only the error-free rows and reports the count", async () => {
    const { rows } = await parseAddressBookCsvToRows(
      csvFile(`label,address,memo\nAlice,${ADDR_A},\nBob,not-an-address,\n`)
    );
    const imported = importAddressBookRows(rows);
    expect(imported).toBe(1);
    expect(getAddressBook()).toHaveLength(1);
    expect(getAddressBook()[0]).toMatchObject({ label: "Alice", publicKey: ADDR_A });
  });
});

describe("export/import round trip", () => {
  it("produces an identical address book after export and re-import", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice", memo: "Invoice 1" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });
    const before = getAddressBook();

    const csv = addressBookToCsv(before);
    localStorage.clear();

    const { rows, fileErrors } = await parseAddressBookCsvToRows(csvFile(csv));
    expect(fileErrors).toEqual([]);
    expect(rows.every((r) => Object.keys(r.errors).length === 0)).toBe(true);

    const imported = importAddressBookRows(rows);
    expect(imported).toBe(before.length);

    const after = getAddressBook();
    expect(after).toHaveLength(before.length);
    expect(
      after.map((e) => ({ publicKey: e.publicKey, label: e.label, memo: e.memo }))
    ).toEqual(
      expect.arrayContaining(
        before.map((e) => ({ publicKey: e.publicKey, label: e.label, memo: e.memo }))
      )
    );
  });

  it("round-trips a label containing a comma and quotes", async () => {
    saveAddress({ publicKey: ADDR_A, label: 'Alice, "The Freelancer"' });
    const before = getAddressBook();

    const csv = addressBookToCsv(before);
    localStorage.clear();

    const { rows } = await parseAddressBookCsvToRows(csvFile(csv));
    importAddressBookRows(rows);

    expect(getAddressBook()[0].label).toBe(before[0].label);
  });

  it("produces a header-only file for an empty address book", () => {
    expect(addressBookToCsv([])).toBe("label,address,memo\n");
  });
});
