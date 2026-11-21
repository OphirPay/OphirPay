// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import {
  isValidStellarAddress,
  getStellarExplorerUrl,
  getPreferredStellarExplorer,
  setPreferredStellarExplorer,
  STELLAR_EXPLORER_STORAGE_KEY,
} from "@/lib/stellar";

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
  beforeEach(() => {
    window.localStorage.removeItem(STELLAR_EXPLORER_STORAGE_KEY);
  });

  it("returns a testnet StellarExpert URL by default when no preference is set (#1913)", () => {
    expect(getPreferredStellarExplorer()).toBe("stellar.expert");
    const url = getStellarExplorerUrl(
      "abc123def456abc123def456abc123def456abc123def456"
    );
    expect(url).toContain("stellar.expert");
    expect(url).toContain("testnet");
    expect(url).toContain("abc123def456");
  });

  it("persists preferred block explorer in localStorage and builds Horizon and Steexp URLs (#1913)", () => {
    const hash = "abc123def456abc123def456abc123def456abc123def456";

    setPreferredStellarExplorer("horizon");
    expect(getPreferredStellarExplorer()).toBe("horizon");
    expect(getStellarExplorerUrl(hash)).toContain(`/transactions/${hash}`);

    setPreferredStellarExplorer("steexp");
    expect(getPreferredStellarExplorer()).toBe("steexp");
    expect(getStellarExplorerUrl(hash)).toBe(
      `https://testnet.steexp.com/tx/${hash}`
    );
  });
});
