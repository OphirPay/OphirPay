// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { truncateAddress } from "@/lib/utils";

// 56-character Stellar public key: G + 55 chars. Ends in "...PQRSTUVW".
const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

describe("truncateAddress", () => {
  it("uses a 56-character address fixture", () => {
    expect(ADDRESS).toHaveLength(56);
  });

  describe("default truncation", () => {
    it("keeps 4 characters at the start and 4 at the end", () => {
      expect(truncateAddress(ADDRESS)).toBe("GABC...TUVW");
    });

    it("formats as GABC...WXYZ", () => {
      const addr = "GABC" + "X".repeat(48) + "WXYZ";
      expect(truncateAddress(addr)).toBe("GABC...WXYZ");
    });

    it("produces a compact 11-character result", () => {
      expect(truncateAddress(ADDRESS)).toHaveLength(11);
    });
  });

  describe("custom lengths", () => {
    it("supports 6 start and 6 end characters", () => {
      expect(truncateAddress(ADDRESS, 6, 6)).toBe("GABCDE...RSTUVW");
    });

    it("supports asymmetric lengths", () => {
      expect(truncateAddress(ADDRESS, 2, 8)).toBe("GA...PQRSTUVW");
    });

    it("supports a zero-length suffix", () => {
      expect(truncateAddress(ADDRESS, 4, 0)).toBe("GABC...");
    });

    it("treats negative lengths as zero", () => {
      expect(truncateAddress(ADDRESS, -3, 4)).toBe("...TUVW");
    });
  });

  describe("short strings", () => {
    it("returns strings shorter than 12 characters unchanged", () => {
      expect(truncateAddress("GABC1234")).toBe("GABC1234");
      expect(truncateAddress("12345678901")).toBe("12345678901");
    });

    it("does not throw on an empty string", () => {
      expect(() => truncateAddress("")).not.toThrow();
      expect(truncateAddress("")).toBe("");
    });

    it("truncates a string of exactly 12 characters with default lengths", () => {
      expect(truncateAddress("GABCDEFGHWXY")).toBe("GABC...HWXY");
    });

    it("returns the original when custom lengths would not shorten it", () => {
      const addr = "GABCDEFGHIJKLMN"; // 15 chars, 6 + 6 + "..." = 15
      expect(truncateAddress(addr, 6, 6)).toBe(addr);
    });
  });
});
