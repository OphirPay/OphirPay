// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  validateContactUniqueness,
  searchAddressBook,
  lookupContactByAddress,
  lookupContactByAlias,
  isBlacklistedAddress,
  isUntrustedAddress,
  saveAddress,
  saveAddressSafe,
  type AddressEntry,
} from "@/lib/address-book";

const ADDR_1 = "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ1";
const ADDR_2 = "GBBDNXFVR2VGBYV6F27W6DX2OQGPY36N3YF7J3BGB3GZ7F7QWY6XYZ2B";
const ADDR_3 = "GCABCDEF234567GHIJKLMN89OPQRSTUVWX345678YZABCDEF00000003";

beforeEach(() => {
  localStorage.clear();
});

describe("Address Book - Search, Deduplication and Conflict Detection (Issue #1316)", () => {
  const sampleBook: AddressEntry[] = [
    {
      publicKey: ADDR_1,
      label: "Treasury Account",
      alias: "treasury",
      federationAddress: "treasury*ophirpay.com",
      memo: "INVOICE-01",
    },
    {
      publicKey: ADDR_2,
      label: "Operations Team",
      alias: "ops_team",
      memo: "PAYROLL-01",
      isUntrusted: true,
    },
    {
      publicKey: ADDR_3,
      label: "Malicious Actor",
      alias: "bad_scam",
      isBlacklisted: true,
    },
  ];

  it("prevents duplicate public keys when validating contact uniqueness", () => {
    const res = validateContactUniqueness(
      { publicKey: ADDR_1, alias: "unique_alias" },
      sampleBook
    );
    expect(res.valid).toBe(false);
    expect(res.conflictType).toBe("duplicate_public_key");
    expect(res.message).toContain(ADDR_1);
  });

  it("prevents duplicate aliases when validating contact uniqueness (case-insensitive)", () => {
    const res = validateContactUniqueness(
      { publicKey: "GNEWADDR000000000000000000000000000000000000000000000009", alias: "TREASURY" },
      sampleBook
    );
    expect(res.valid).toBe(false);
    expect(res.conflictType).toBe("duplicate_alias");
    expect(res.message).toContain("TREASURY");
  });

  it("permits self-updates when editing an existing contact", () => {
    const res = validateContactUniqueness(
      { publicKey: ADDR_1, alias: "treasury", label: "Updated Treasury" },
      sampleBook,
      ADDR_1
    );
    expect(res.valid).toBe(true);
  });

  it("searches contacts across label, alias, federation address, and public key", () => {
    expect(searchAddressBook("treasury", sampleBook)).toHaveLength(1);
    expect(searchAddressBook("ops_team", sampleBook)).toHaveLength(1);
    expect(searchAddressBook("ophirpay.com", sampleBook)).toHaveLength(1);
    expect(searchAddressBook("GCABCDEF", sampleBook)).toHaveLength(1);
    expect(searchAddressBook("nonexistent", sampleBook)).toHaveLength(0);
  });

  it("looks up contact by address and alias safely", () => {
    expect(lookupContactByAddress(ADDR_1, sampleBook)?.label).toBe("Treasury Account");
    expect(lookupContactByAddress(" " + ADDR_2 + " ", sampleBook)?.alias).toBe("ops_team");
    expect(lookupContactByAlias("ops_team", sampleBook)?.publicKey).toBe(ADDR_2);
    expect(lookupContactByAlias("treasury", sampleBook)?.publicKey).toBe(ADDR_1);
    expect(lookupContactByAlias("unknown", sampleBook)).toBeUndefined();
  });

  it("detects blacklisted and untrusted contacts", () => {
    expect(isBlacklistedAddress(ADDR_3, sampleBook)).toBe(true);
    expect(isUntrustedAddress(ADDR_3, sampleBook)).toBe(true);
    expect(isUntrustedAddress(ADDR_2, sampleBook)).toBe(true);
    expect(isBlacklistedAddress(ADDR_2, sampleBook)).toBe(false);
    expect(isBlacklistedAddress(ADDR_1, sampleBook)).toBe(false);
  });

  it("saves address with deduplication and reports conflicts", () => {
    sampleBook.forEach((e) => saveAddress(e));

    const conflict = saveAddressSafe({
      publicKey: "GANOTHERADDR00000000000000000000000000000000000000000000000",
      label: "Duplicate",
      alias: "treasury",
    });
    expect(conflict.success).toBe(false);
    expect(conflict.conflictType).toBe("duplicate_alias");

    const valid = saveAddressSafe({
      publicKey: "GANOTHERADDR00000000000000000000000000000000000000000000000",
      label: "Valid Brand New",
      alias: "brand_new_alias",
    });
    expect(valid.success).toBe(true);
  });
});
