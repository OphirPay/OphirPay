// SPDX-License-Identifier: MIT
// Tests for mergeAddressBookSelections — deduping address book picks against
// existing batch rows (manual or CSV-imported).

import { describe, it, expect } from "vitest";
import { mergeAddressBookSelections } from "@/lib/address-book";
import type { AddressEntry } from "@/lib/address-book";

const ALICE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BOB = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const CAROL = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function entry(publicKey: string, label: string, memo?: string): AddressEntry {
  return { publicKey, label, memo };
}

describe("address-book > mergeAddressBookSelections", () => {
  it("returns all entries when none of the addresses already exist", () => {
    const entries = [entry(ALICE, "Alice"), entry(BOB, "Bob")];
    expect(mergeAddressBookSelections(entries, [])).toEqual(entries);
  });

  it("drops entries whose address is already in the batch", () => {
    const entries = [entry(ALICE, "Alice"), entry(BOB, "Bob"), entry(CAROL, "Carol")];
    const merged = mergeAddressBookSelections(entries, [ALICE]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.publicKey)).toEqual([BOB, CAROL]);
  });

  it("drops multiple duplicates at once", () => {
    const entries = [entry(ALICE, "Alice"), entry(BOB, "Bob")];
    const merged = mergeAddressBookSelections(entries, [ALICE, BOB]);
    expect(merged).toEqual([]);
  });

  it("ignores surrounding whitespace on existing addresses", () => {
    const entries = [entry(ALICE, "Alice")];
    const merged = mergeAddressBookSelections(entries, [`  ${ALICE}  `]);
    expect(merged).toEqual([]);
  });

  it("returns an empty array for empty selections", () => {
    expect(mergeAddressBookSelections([], [ALICE])).toEqual([]);
  });

  it("preserves entry metadata (label, memo) on merged rows", () => {
    const entries = [entry(ALICE, "Alice", "payroll"), entry(BOB, "Bob")];
    const merged = mergeAddressBookSelections(entries, [CAROL]);
    expect(merged[0]).toEqual({ publicKey: ALICE, label: "Alice", memo: "payroll" });
    expect(merged[1].memo).toBeUndefined();
  });

  it("does not mutate the input arrays", () => {
    const entries = [entry(ALICE, "Alice")];
    const existing = [ALICE];
    mergeAddressBookSelections(entries, existing);
    expect(entries).toHaveLength(1);
    expect(existing).toEqual([ALICE]);
  });
});
