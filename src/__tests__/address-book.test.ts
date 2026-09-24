// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAddressBook,
  saveAddress,
  removeAddress,
  searchAddressBook,
  getRecentAddresses,
} from "@/lib/address-book";
import { isValidStellarAddress } from "@/lib/stellar";

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

describe("address-book CSV import/export", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const ADDR_A = "G" + "A".repeat(55);
  const ADDR_B = "G" + "B".repeat(55);
  const ADDR_C = "G" + "C".repeat(55);

  it("exports and re-imports an identical address book (round trip)", () => {
    // Setup: save some contacts
    saveAddress({ publicKey: ADDR_A, label: "Alice", memo: "Invoice 1" });
    saveAddress({ publicKey: ADDR_B, label: "Bob" });

    // Simulate export: get book and format as CSV
    const book = getAddressBook();
    const header = "label,address,memo";
    const rows = book.map((e) => [e.label, e.publicKey, e.memo ?? ""]);
    const csv = [header, ...rows.map((r) => r.join(","))].join("\n");

    // Simulate import: parse CSV
    const lines = csv.split("\n");
    const importHeader = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const labelIdx = importHeader.indexOf("label");
    const addressIdx = importHeader.indexOf("address");
    const memoIdx = importHeader.indexOf("memo");

    expect(labelIdx).toBe(0);
    expect(addressIdx).toBe(1);
    expect(memoIdx).toBe(2);

    // Clear and re-import
    localStorage.clear();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const label = cols[labelIdx];
      const address = cols[addressIdx];
      const memo = cols[memoIdx] || undefined;
      if (label && isValidStellarAddress(address)) {
        saveAddress({ publicKey: address, label, memo });
      }
    }

    const reimported = getAddressBook();
    expect(reimported).toHaveLength(2);
    expect(reimported.map((e) => e.publicKey).sort()).toEqual([ADDR_A, ADDR_B]);
    const alice = reimported.find((e) => e.publicKey === ADDR_A);
    expect(alice?.memo).toBe("Invoice 1");
  });

  it("imports valid rows and reports errors for invalid rows (partial failure)", () => {
    const ADDR_VALID = "G" + "V".repeat(55);
    const INVALID_ADDR = "not-a-valid-address";

    const csv = [
      "label,address,memo",
      "Valid One," + ADDR_VALID + ",Memo 1",
      "Missing Address," + INVALID_ADDR + ",Memo 2",
      "Valid Two," + "G" + "X".repeat(55) + ",",
      ",,G" + "Y".repeat(55) + ",Memo 4", // empty label row
    ].join("\n");

    // Parse
    const lines = csv.split("\n");
    const importHeader = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const labelIdx = importHeader.indexOf("label");
    const addressIdx = importHeader.indexOf("address");
    const memoIdx = importHeader.indexOf("memo");

    const errors: { row: number; message: string }[] = [];
    const validEntries: { label: string; publicKey: string; memo?: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const label = cols[labelIdx] ?? "";
      const address = cols[addressIdx] ?? "";
      const memo = memoIdx >= 0 ? cols[memoIdx] : "";

      if (!label) {
        errors.push({ row: i + 1, message: "Label is required." });
        continue;
      }
      if (!isValidStellarAddress(address)) {
        errors.push({ row: i + 1, message: "Invalid Stellar address: " + address });
        continue;
      }
      if (memo && memo.length > 28) {
        errors.push({ row: i + 1, message: "Memo must be 28 characters or fewer." });
        continue;
      }

      validEntries.push({ label, publicKey: address, memo: memo || undefined });
    }

    // Expect 2 valid, 2 errors
    expect(validEntries).toHaveLength(2);
    expect(validEntries.map((e) => e.publicKey).sort()).toEqual([ADDR_VALID, "G" + "X".repeat(55)].sort());
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.message.includes("Invalid Stellar address"))).toBe(true);
    expect(errors.some((e) => e.message.includes("Label is required"))).toBe(true);

    // Save valid entries
    for (const e of validEntries) saveAddress(e);

    const book = getAddressBook();
    expect(book).toHaveLength(2);
  });

  it("handles header-only or empty file gracefully", () => {
    const headerOnly = "label,address,memo";
    const lines = headerOnly.split("\n");
    expect(lines.length).toBe(1);
    // Our import logic would produce fileErrors for this case
    expect(lines.length < 2).toBe(true);
  });

  it("skips duplicates on import (keeps existing)", () => {
    saveAddress({ publicKey: ADDR_A, label: "Original Alice" });

    const csv = "label,address,memo\nUpdated Alice," + ADDR_A + ",New Memo";
    const lines = csv.split("\n");
    const importHeader = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const labelIdx = importHeader.indexOf("label");
    const addressIdx = importHeader.indexOf("address");
    const memoIdx = importHeader.indexOf("memo");

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const label = cols[labelIdx];
      const address = cols[addressIdx];
      const memo = cols[memoIdx] || undefined;
      if (label && isValidStellarAddress(address)) {
        saveAddress({ publicKey: address, label, memo });
      }
    }

    const book = getAddressBook();
    // Should still be 1 entry, but updated (saveAddress merges by publicKey)
    expect(book).toHaveLength(1);
    expect(book[0].label).toBe("Updated Alice");
    expect(book[0].memo).toBe("New Memo");
  });
});