// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAddressBook,
  saveAddress,
  removeAddress,
  searchAddressBook,
  getRecentAddresses,
  importAddressBookCsv,
} from "@/lib/address-book";

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);

describe("address-book (localStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(getAddressBook()).toEqual([]);
  });

  it("saves a contact", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    const book = getAddressBook();
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({ publicKey: ADDR_A, label: "Alice" });
    expect(book[0].lastUsed).toBeTypeOf("number");
  });

  it("updates an existing contact by publicKey (no duplicates)", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_A, label: "Alice — Freelance", memo: "Invoice 42" });
    const book = getAddressBook();
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({
      publicKey: ADDR_A,
      label: "Alice — Freelance",
      memo: "Invoice 42",
    });
  });

  it("removes a contact by publicKey", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });
    removeAddress(ADDR_A);
    const book = getAddressBook();
    expect(book).toHaveLength(1);
    expect(book[0].publicKey).toBe(ADDR_B);
  });

  it("is resilient to corrupted localStorage", () => {
    localStorage.setItem("ophirpay-address-book", "{not json");
    expect(getAddressBook()).toEqual([]);
  });

  it("imports BOM-prefixed CSV with quoted fields and optional memos", () => {
    const result = importAddressBookCsv(
      `\uFEFFlabel,publicKey,memo\r\n"Alice, Freelance",${ADDR_A},"Invoice ""42"""\r\nBob,${ADDR_B},\r\n`
    );

    expect(result).toEqual({ added: 2, updated: 0, rejected: [] });
    expect(getAddressBook()).toMatchObject([
      { label: "Alice, Freelance", publicKey: ADDR_A, memo: 'Invoice "42"' },
      { label: "Bob", publicKey: ADDR_B },
    ]);
  });

  it("reports invalid rows and duplicate addresses without dropping row details", () => {
    const result = importAddressBookCsv(
      `label,address,memo\nGood,${ADDR_A},\nBad address,not-stellar,\nDuplicate,${ADDR_A},\n,${ADDR_B},\n`
    );

    expect(result).toEqual({
      added: 1,
      updated: 0,
      rejected: [
        { row: 3, message: "Invalid Stellar address." },
        { row: 4, message: "Duplicate address in CSV." },
        { row: 5, message: "Label is required." },
      ],
    });
    expect(getAddressBook().map((entry) => entry.publicKey)).toEqual([ADDR_A]);
  });

  it("updates matching contacts while preserving memo and last-used data when CSV memo is blank", () => {
    localStorage.setItem(
      "ophirpay-address-book",
      JSON.stringify([{ publicKey: ADDR_A, label: "Old label", memo: "Keep me", lastUsed: 123 }])
    );

    const result = importAddressBookCsv(`label,address,memo\nNew label,${ADDR_A},\n`);

    expect(result).toEqual({ added: 0, updated: 1, rejected: [] });
    expect(getAddressBook()).toEqual([
      { publicKey: ADDR_A, label: "New label", memo: "Keep me", lastUsed: 123 },
    ]);
  });

  it("rejects invalid headers and label or memo values", () => {
    expect(importAddressBookCsv("name,address\nAlice," + ADDR_A)).toMatchObject({
      added: 0,
      rejected: [{ row: 1, message: expect.stringContaining("header must include label") }],
    });
    const result = importAddressBookCsv(
      `label,address,memo\n${"L".repeat(101)},${ADDR_A},${"M".repeat(29)}\n`
    );
    expect(result.rejected).toEqual([{
      row: 2,
      message: "Label must be 100 characters or fewer. Memo must be 28 characters or fewer.",
    }]);
    expect(getAddressBook()).toEqual([]);
  });

  it("searches by label (case-insensitive)", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    saveAddress({ publicKey: ADDR_B, label: "Bob the Builder" });
    expect(searchAddressBook("alice").map((a) => a.publicKey)).toEqual([ADDR_A]);
    expect(searchAddressBook("BUILDER").map((a) => a.publicKey)).toEqual([ADDR_B]);
  });

  it("searches by partial address", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    const partial = ADDR_A.slice(0, 10);
    expect(searchAddressBook(partial).map((a) => a.publicKey)).toEqual([ADDR_A]);
  });

  it("returns empty for no matches", () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    expect(searchAddressBook("zzz")).toEqual([]);
  });

  it("lists recent addresses ordered by lastUsed (limit applies)", async () => {
    saveAddress({ publicKey: ADDR_A, label: "Alice" });
    // Ensure Bob's lastUsed is strictly later than Alice's (Date.now() can
    // otherwise collide within the same millisecond)
    await new Promise((r) => setTimeout(r, 5));
    saveAddress({ publicKey: ADDR_B, label: "Bob" });

    expect(getRecentAddresses(1).map((a) => a.publicKey)).toEqual([ADDR_B]);
    expect(getRecentAddresses(5).map((a) => a.publicKey)).toEqual([ADDR_B, ADDR_A]);
  });
});
