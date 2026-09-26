// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  exportAddressBookToCsv,
  parseAddressBookCsv,
  importAddressBookEntries,
  escapeAddressBookCsvField,
} from "@/lib/address-book-csv";
import { getAddressBook, type AddressEntry } from "@/lib/address-book";

// Valid Stellar test addresses (56 characters starting with G)
const ADDR_ALICE = "G" + "A".repeat(55);
const ADDR_BOB = "G" + "B".repeat(55);
const ADDR_CHARLIE = "G" + "C".repeat(55);

describe("Address Book CSV import, export & round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("parseAddressBookCsv", () => {
    it("returns a clear message when file is completely empty or only whitespace", () => {
      const res1 = parseAddressBookCsv("");
      expect(res1.entries).toEqual([]);
      expect(res1.errors).toEqual([]);
      expect(res1.message).toBe("CSV file is empty.");

      const res2 = parseAddressBookCsv("   \n\r\n   \t  ");
      expect(res2.entries).toEqual([]);
      expect(res2.errors).toEqual([]);
      expect(res2.message).toBe("CSV file is empty.");
    });

    it("returns a clear message when file only contains a header row", () => {
      const csv = "label,address,memo\n";
      const res = parseAddressBookCsv(csv);
      expect(res.entries).toEqual([]);
      expect(res.errors).toEqual([]);
      expect(res.message).toBe("CSV file contains only a header row with no address entries.");
    });

    it("successfully parses valid CSV with standard headers", () => {
      const csv = `label,address,memo
Alice,${ADDR_ALICE},Salary
Bob,${ADDR_BOB},Vendor
Charlie,${ADDR_CHARLIE},`;

      const res = parseAddressBookCsv(csv);
      expect(res.errors).toEqual([]);
      expect(res.entries).toHaveLength(3);
      expect(res.entries[0]).toEqual({
        publicKey: ADDR_ALICE,
        label: "Alice",
        memo: "Salary",
      });
      expect(res.entries[1]).toEqual({
        publicKey: ADDR_BOB,
        label: "Bob",
        memo: "Vendor",
      });
      expect(res.entries[2]).toEqual({
        publicKey: ADDR_CHARLIE,
        label: "Charlie",
        memo: undefined,
      });
    });

    it("supports flexible header aliases (name, public_key, note)", () => {
      const csv = `name,public_key,note
Alice,${ADDR_ALICE},Invoice 1`;

      const res = parseAddressBookCsv(csv);
      expect(res.errors).toEqual([]);
      expect(res.entries).toHaveLength(1);
      expect(res.entries[0]).toEqual({
        publicKey: ADDR_ALICE,
        label: "Alice",
        memo: "Invoice 1",
      });
    });

    it("keeps valid rows and reports row numbers and reasons for invalid rows (partial failure)", () => {
      const csv = `label,address,memo
Alice,${ADDR_ALICE},First
,${ADDR_BOB},Missing label
InvalidAddress,INVALID_STELLAR_KEY,Bad key
MemoTooLong,${ADDR_CHARLIE},This memo is definitely longer than 28 characters limit`;

      const res = parseAddressBookCsv(csv);
      // Row 1 is header.
      // Row 2: Alice -> valid
      // Row 3: Missing label -> error
      // Row 4: Invalid address -> error
      // Row 5: Memo too long -> error

      expect(res.entries).toHaveLength(1);
      expect(res.entries[0].label).toBe("Alice");

      expect(res.errors).toHaveLength(3);
      expect(res.errors[0].row).toBe(3);
      expect(res.errors[0].message).toContain("Nickname / label is required");

      expect(res.errors[1].row).toBe(4);
      expect(res.errors[1].message).toContain("Invalid Stellar address");

      expect(res.errors[2].row).toBe(5);
      expect(res.errors[2].message).toContain("Memo must be 28 characters or fewer");
    });

    it("handles quotes and commas in fields correctly", () => {
      const csv = `label,address,memo
"Doe, Alice",${ADDR_ALICE},"Consulting, LLC"`;

      const res = parseAddressBookCsv(csv);
      expect(res.errors).toEqual([]);
      expect(res.entries).toHaveLength(1);
      expect(res.entries[0]).toEqual({
        publicKey: ADDR_ALICE,
        label: "Doe, Alice",
        memo: "Consulting, LLC",
      });
    });
  });

  describe("exportAddressBookToCsv and round-trip", () => {
    it("round-trips contacts identically (export -> parse)", () => {
      const original: AddressEntry[] = [
        { publicKey: ADDR_ALICE, label: "Alice Cooper", memo: "Payroll" },
        { publicKey: ADDR_BOB, label: "Bob Dylan", memo: undefined },
        { publicKey: ADDR_CHARLIE, label: "Charlie, Brown", memo: "Comic" },
      ];

      const csv = exportAddressBookToCsv(original);
      const parsed = parseAddressBookCsv(csv);

      expect(parsed.errors).toEqual([]);
      expect(parsed.entries).toEqual(original);
    });

    it("guards against spreadsheet formula injection", () => {
      expect(escapeAddressBookCsvField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(escapeAddressBookCsvField("+123456")).toBe("'+123456");
      expect(escapeAddressBookCsvField("-500")).toBe("'-500");
      expect(escapeAddressBookCsvField("@Admin")).toBe("'@Admin");
    });
  });

  describe("importAddressBookEntries", () => {
    it("saves entries to localStorage address book", () => {
      const contacts: AddressEntry[] = [
        { publicKey: ADDR_ALICE, label: "Alice" },
        { publicKey: ADDR_BOB, label: "Bob", memo: "Freelancer" },
      ];

      const count = importAddressBookEntries(contacts);
      expect(count).toBe(2);

      const saved = getAddressBook();
      expect(saved).toHaveLength(2);
      expect(saved[0].publicKey).toBe(ADDR_ALICE);
      expect(saved[1].publicKey).toBe(ADDR_BOB);
    });
  });
});
