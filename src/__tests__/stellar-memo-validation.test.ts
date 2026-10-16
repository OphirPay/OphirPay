// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  validateStellarMemo,
  stellarMemoTypeSchema,
  refineStellarMemo,
  stellarTextMemoSchema,
  MEMO_MAX_BYTES,
  MAX_UINT64,
} from "@/lib/validation/stellar";
import { z } from "zod";

describe("Stellar Memo Validation & Character Set Enforcement", () => {
  describe("MEMO_TEXT variant", () => {
    it("accepts valid ASCII text within 28 bytes", () => {
      const result = validateStellarMemo("invoice-10294", "MEMO_TEXT");
      expect(result.valid).toBe(true);
      expect(result.type).toBe("MEMO_TEXT");
      expect(result.byteLength).toBe(13);
    });

    it("accepts exactly 28 bytes ASCII memo", () => {
      const memo28 = "a".repeat(28);
      const result = validateStellarMemo(memo28, "MEMO_TEXT");
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(28);
    });

    it("rejects 29 bytes ASCII memo with descriptive error message", () => {
      const memo29 = "a".repeat(29);
      const result = validateStellarMemo(memo29, "MEMO_TEXT");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds 28 UTF-8 bytes limit (received 29 bytes)");
      expect(result.byteLength).toBe(29);
    });

    it("correctly counts multibyte UTF-8 characters (emojis, accents)", () => {
      // 🚀 is 4 bytes
      const emojiMemo = "🚀".repeat(7); // 7 * 4 = 28 bytes
      const result = validateStellarMemo(emojiMemo, "MEMO_TEXT");
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(28);

      // 8 rockets = 32 bytes (fails fast)
      const oversizedEmoji = "🚀".repeat(8);
      const failResult = validateStellarMemo(oversizedEmoji, "MEMO_TEXT");
      expect(failResult.valid).toBe(false);
      expect(failResult.byteLength).toBe(32);
      expect(failResult.error).toContain("received 32 bytes");

      // Accented chars: "é" is 2 bytes in UTF-8
      const accentMemo = "café"; // 3 + 2 = 5 bytes
      const accentResult = validateStellarMemo(accentMemo, "MEMO_TEXT");
      expect(accentResult.valid).toBe(true);
      expect(accentResult.byteLength).toBe(5);
    });

    it("rejects control characters (C0 / C1) and invisible/bidi formatting", () => {
      expect(validateStellarMemo("hello\x00world", "MEMO_TEXT").valid).toBe(false);
      expect(validateStellarMemo("line1\nline2", "MEMO_TEXT").valid).toBe(false);
      expect(validateStellarMemo("tab\there", "MEMO_TEXT").valid).toBe(false);
      expect(validateStellarMemo("invis\u200Bzero", "MEMO_TEXT").valid).toBe(false);
      expect(validateStellarMemo("bidi\u202Ereversed", "MEMO_TEXT").valid).toBe(false);
    });

    it("handles undefined, null, or empty string gracefully as valid", () => {
      expect(validateStellarMemo(undefined, "MEMO_TEXT").valid).toBe(true);
      expect(validateStellarMemo(null, "MEMO_TEXT").valid).toBe(true);
      expect(validateStellarMemo("", "MEMO_TEXT").valid).toBe(true);
    });
  });

  describe("MEMO_ID variant", () => {
    it("accepts valid 64-bit unsigned integer strings", () => {
      expect(validateStellarMemo("0", "MEMO_ID").valid).toBe(true);
      expect(validateStellarMemo("1234567890", "MEMO_ID").valid).toBe(true);
      expect(validateStellarMemo("9007199254740991", "MEMO_ID").valid).toBe(true); // Number.MAX_SAFE_INTEGER
      expect(validateStellarMemo(MAX_UINT64.toString(), "MEMO_ID").valid).toBe(true); // 18446744073709551615
    });

    it("rejects non-numeric characters in MEMO_ID", () => {
      const result = validateStellarMemo("1234abc", "MEMO_ID");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("must be a non-negative 64-bit integer string");
    });

    it("rejects negative numbers in MEMO_ID", () => {
      const result = validateStellarMemo("-42", "MEMO_ID");
      expect(result.valid).toBe(false);
    });

    it("rejects numbers exceeding 64-bit uint range (> 18446744073709551615)", () => {
      const oversized = "18446744073709551616"; // MAX_UINT64 + 1
      const result = validateStellarMemo(oversized, "MEMO_ID");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("out of range");
    });

    it("rejects decimal numbers in MEMO_ID", () => {
      const result = validateStellarMemo("123.45", "MEMO_ID");
      expect(result.valid).toBe(false);
    });
  });

  describe("MEMO_HASH variant", () => {
    const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 chars

    it("accepts 64-character hexadecimal strings (32 bytes)", () => {
      expect(validateStellarMemo(validHash, "MEMO_HASH").valid).toBe(true);
      expect(validateStellarMemo(validHash.toUpperCase(), "MEMO_HASH").valid).toBe(true);
    });

    it("rejects hashes with incorrect length", () => {
      const shortHash = validHash.slice(0, 63);
      const resShort = validateStellarMemo(shortHash, "MEMO_HASH");
      expect(resShort.valid).toBe(false);
      expect(resShort.error).toContain("must be a 64-character hexadecimal string");

      const longHash = validHash + "a";
      const resLong = validateStellarMemo(longHash, "MEMO_HASH");
      expect(resLong.valid).toBe(false);
    });

    it("rejects non-hex characters in MEMO_HASH", () => {
      const nonHex = "g".repeat(64);
      const result = validateStellarMemo(nonHex, "MEMO_HASH");
      expect(result.valid).toBe(false);
    });
  });

  describe("MEMO_RETURN variant", () => {
    const validReturn = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    it("accepts 64-character hexadecimal return hashes", () => {
      expect(validateStellarMemo(validReturn, "MEMO_RETURN").valid).toBe(true);
      expect(validateStellarMemo(validReturn.toUpperCase(), "MEMO_RETURN").valid).toBe(true);
    });

    it("rejects non-hex or invalid length strings in MEMO_RETURN", () => {
      expect(validateStellarMemo("invalid", "MEMO_RETURN").valid).toBe(false);
      expect(validateStellarMemo(validReturn.slice(0, 32), "MEMO_RETURN").valid).toBe(false);
    });
  });

  describe("Zod schema and refinement integration", () => {
    const testSchema = z
      .object({
        memo: z.string().optional(),
        memoType: stellarMemoTypeSchema.optional(),
      })
      .superRefine((data, ctx) => {
        refineStellarMemo(data, ctx);
      });

    it("validates valid payload with Zod schema", () => {
      const parsed = testSchema.safeParse({ memo: "pay-123", memoType: "MEMO_TEXT" });
      expect(parsed.success).toBe(true);
    });

    it("returns Zod validation error for oversized text memo", () => {
      const parsed = testSchema.safeParse({
        memo: "This memo string is way too long to fit in 28 bytes",
        memoType: "MEMO_TEXT",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toContain("exceeds 28 UTF-8 bytes limit");
        expect(parsed.error.issues[0].path).toEqual(["memo"]);
      }
    });

    it("validates standalone stellarTextMemoSchema", () => {
      expect(stellarTextMemoSchema.safeParse("Valid memo").success).toBe(true);
      expect(stellarTextMemoSchema.safeParse("Too long text memo that definitely exceeds 28 bytes limit").success).toBe(false);
    });
  });
});
