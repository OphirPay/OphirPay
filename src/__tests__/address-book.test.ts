// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAddressBook,
  saveAddress,
  removeAddress,
  searchAddressBook,
  getRecentAddresses,
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
