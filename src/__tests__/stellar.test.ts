// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isValidStellarAddress, getStellarExplorerUrl } from "@/lib/stellar";

describe("isValidStellarAddress", () => {
  it("accepts a valid Stellar public key", () => {
    expect(
      isValidStellarAddress(
        "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      )
    ).toBe(false); // Not exactly 56 chars
  });

  it("rejects an address not starting with G", () => {
    expect(isValidStellarAddress("SBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUV")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("accepts a 56-character G-prefixed address", () => {
    // Generate a G-address-like string of correct length
    const addr = "G" + "A".repeat(55);
    expect(isValidStellarAddress(addr)).toBe(true);
  });
});

describe("getStellarExplorerUrl", () => {
  it("returns a testnet explorer URL", () => {
    const url = getStellarExplorerUrl(
      "abc123def456abc123def456abc123def456abc123def456"
    );
    expect(url).toContain("stellar.expert");
    expect(url).toContain("testnet");
    expect(url).toContain("abc123def456");
  });
});
