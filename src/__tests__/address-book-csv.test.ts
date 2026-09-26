// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  formatAddressBookCsv,
  parseAddressBookCsvText,
  saveAddressBatch,
  getAddressBook,
  type AddressEntry,
} from "@/lib/address-book";

const VALID_ADDR_1 = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2CTRBIAP2W2QASXYZW1";
const VALID_ADDR_2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_ADDR_3 = "GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGHD7UAKFD75JILZBCA3QW6";
const INVALID_ADDR = "G_INVALID_ADDRESS_LESS_THAN_56_CHARS";

describe("Address Book CSV - Export & Import Round Trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exports and re-imports an address book with identical results", () => {
    const originalEntries: AddressEntry[] = [
      {
        label: "Treasury Wallet",
        publicKey: VALID_ADDR_1,
        memo: "Monthly allocation",
        asset: "USDC",
      },
      {
        label: "Contributor Grant",
        publicKey: VALID_ADDR_2,
        memo: "Milestone 1",
        asset: "XLM",
      },
      {
        label: "Operations Fund",
        publicKey: VALID_ADDR_3,
      },
    ];

    const csvOutput = formatAddressBookCsv(originalEntries);
    const result = parseAddressBookCsvText(csvOutput);

    expect(result.isEmpty).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.validEntries).toEqual(originalEntries);
  });

  it("handles complex RFC 4180 escaping (commas, quotes, newlines) round-trip", () => {
    const originalEntries: AddressEntry[] = [
      {
        label: 'Alice, "The Lead" & Co.',
        publicKey: VALID_ADDR_1,
        memo: "Invoice, #1024",
        asset: "USDC",
      },
      {
        label: "Multi-line\nOrg Contact",
        publicKey: VALID_ADDR_2,
      },
    ];

    const csvOutput = formatAddressBookCsv(originalEntries);
    const result = parseAddressBookCsvText(csvOutput);

    expect(result.errors).toHaveLength(0);
    expect(result.validEntries).toEqual(originalEntries);
  });
});

describe("Address Book CSV - Partial Failure & Error Reporting", () => {
  it("keeps valid rows while reporting invalid rows with row numbers and reasons", () => {
    const mixedCsv = [
      "label,address,memo,asset",
      `Alice,${VALID_ADDR_1},inv-1,USDC`, // Row 2: VALID
      `Bob,${INVALID_ADDR},,XLM`, // Row 3: INVALID ADDRESS
      `Charlie,${VALID_ADDR_2},,`, // Row 4: VALID
      `,${VALID_ADDR_3},missing-label,`, // Row 5: MISSING LABEL
      `Dave,${VALID_ADDR_3},memo-is-far-too-long-for-stellar-memo-limit,`, // Row 6: MEMO > 28 BYTES
      `Eve,${VALID_ADDR_1},valid,INVALID_ASSET_CODE_TOO_LONG`, // Row 7: ASSET > 12 CHARS
    ].join("\n");

    const result = parseAddressBookCsvText(mixedCsv);

    expect(result.totalRows).toBe(6);
    expect(result.validEntries).toHaveLength(2);
    expect(result.validEntries[0]).toEqual({
      label: "Alice",
      publicKey: VALID_ADDR_1,
      memo: "inv-1",
      asset: "USDC",
    });
    expect(result.validEntries[1]).toEqual({
      label: "Charlie",
      publicKey: VALID_ADDR_2,
    });

    expect(result.errors).toHaveLength(4);

    // Row 3: Invalid address
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].reason).toContain("Invalid Stellar address");

    // Row 5: Missing label
    expect(result.errors[1].row).toBe(5);
    expect(result.errors[1].reason).toContain("Nickname or label is required");

    // Row 6: Memo > 28 bytes
    expect(result.errors[2].row).toBe(6);
    expect(result.errors[2].reason).toContain("Memo must be 28 characters or fewer");

    // Row 7: Asset code > 12 chars
    expect(result.errors[3].row).toBe(7);
    expect(result.errors[3].reason).toContain("Asset code must be 1 to 12 alphanumeric characters");
  });
});

describe("Address Book CSV - Empty & Header-Only Handling", () => {
  it("produces a clear message rather than an error for empty file", () => {
    const result1 = parseAddressBookCsvText("");
    expect(result1.isEmpty).toBe(true);
    expect(result1.errors).toHaveLength(0);
    expect(result1.validEntries).toHaveLength(0);
    expect(result1.message).toContain("CSV file is empty");

    const result2 = parseAddressBookCsvText("   \n\t  \n");
    expect(result2.isEmpty).toBe(true);
    expect(result2.errors).toHaveLength(0);
    expect(result2.message).toContain("CSV file is empty");
  });

  it("produces a clear message rather than an error for header-only file", () => {
    const headerOnly = "label,address,memo,asset\n";
    const result = parseAddressBookCsvText(headerOnly);

    expect(result.isEmpty).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.validEntries).toHaveLength(0);
    expect(result.message).toContain("contains only headers");
  });
});

describe("Address Book CSV - Flexible Column Order & Aliases", () => {
  it("parses CSV with reordered and aliased columns", () => {
    const reorderedCsv = [
      "destination,name,tag,currency",
      `${VALID_ADDR_1},Alice Core,donation,EURC`,
    ].join("\n");

    const result = parseAddressBookCsvText(reorderedCsv);
    expect(result.errors).toHaveLength(0);
    expect(result.validEntries).toEqual([
      {
        publicKey: VALID_ADDR_1,
        label: "Alice Core",
        memo: "donation",
        asset: "EURC",
      },
    ]);
  });

  it("parses positional rows with address in first column", () => {
    const positional = [
      "col1,col2,col3",
      `${VALID_ADDR_1},Alice Treasury,memo1`,
    ].join("\n");

    const result = parseAddressBookCsvText(positional);
    expect(result.errors).toHaveLength(0);
    expect(result.validEntries).toEqual([
      {
        publicKey: VALID_ADDR_1,
        label: "Alice Treasury",
        memo: "memo1",
      },
    ]);
  });
});

describe("saveAddressBatch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("batch saves new entries and updates existing ones without duplicating", () => {
    const initial: AddressEntry[] = [
      { publicKey: VALID_ADDR_1, label: "Alice", memo: "old-memo" },
    ];
    saveAddressBatch(initial);

    const book1 = getAddressBook();
    expect(book1).toHaveLength(1);
    expect(book1[0].label).toBe("Alice");

    const updates: AddressEntry[] = [
      { publicKey: VALID_ADDR_1, label: "Alice Updated", memo: "new-memo", asset: "USDC" },
      { publicKey: VALID_ADDR_2, label: "Bob", asset: "XLM" },
    ];
    const { added, updated } = saveAddressBatch(updates);

    expect(added).toBe(1);
    expect(updated).toBe(1);

    const book2 = getAddressBook();
    expect(book2).toHaveLength(2);
    expect(book2.find((e) => e.publicKey === VALID_ADDR_1)).toMatchObject({
      label: "Alice Updated",
      memo: "new-memo",
      asset: "USDC",
    });
    expect(book2.find((e) => e.publicKey === VALID_ADDR_2)).toMatchObject({
      label: "Bob",
      asset: "XLM",
    });
  });
});
