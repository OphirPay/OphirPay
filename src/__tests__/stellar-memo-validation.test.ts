// SPDX-License-Identifier: MIT

/**
 * Unit test suite for Stellar transaction memo validation across all four variants.
 * Issue #1368 — Buffer.byteLength UTF-8 accounting, MEMO_TEXT, MEMO_ID, MEMO_HASH, MEMO_RETURN.
 */

import { describe, it, expect } from "vitest";
import {
  validateStellarMemo,
  normalizeMemoType,
  stellarMemoField,
  stellarMemoSchema,
  STELLAR_MEMO_ERROR_MESSAGES,
  MEMO_TEXT_MAX_BYTES,
  MEMO_ID_MAX,
} from "@/lib/validation/stellar";

describe("normalizeMemoType (#1368)", () => {
  it("exposes canonical constants", () => {
    expect(MEMO_TEXT_MAX_BYTES).toBe(28);
  });
  it("normalizes case-insensitively and handles short aliases", () => {
    expect(normalizeMemoType("text")).toBe("MEMO_TEXT");
    expect(normalizeMemoType("MEMO_TEXT")).toBe("MEMO_TEXT");
    expect(normalizeMemoType("id")).toBe("MEMO_ID");
    expect(normalizeMemoType("memo_id")).toBe("MEMO_ID");
    expect(normalizeMemoType("hash")).toBe("MEMO_HASH");
    expect(normalizeMemoType("memo_hash")).toBe("MEMO_HASH");
    expect(normalizeMemoType("return")).toBe("MEMO_RETURN");
    expect(normalizeMemoType("memo_return")).toBe("MEMO_RETURN");
    expect(normalizeMemoType("unknown")).toBe("MEMO_TEXT");
  });
});

describe("MEMO_TEXT validation (#1368)", () => {
  it("accepts ASCII text up to 28 bytes", () => {
    const res = validateStellarMemo("inv-12345", "MEMO_TEXT");
    expect(res.valid).toBe(true);
    expect(res.byteLength).toBe(9);

    const exact28 = "a".repeat(28);
    const res28 = validateStellarMemo(exact28, "MEMO_TEXT");
    expect(res28.valid).toBe(true);
    expect(res28.byteLength).toBe(28);
  });

  it("correctly counts UTF-8 multibyte characters (emojis, accents, non-Latin)", () => {
    // 7 emojis = 7 * 4 bytes = 28 bytes exactly -> valid
    const sevenEmojis = "😀".repeat(7);
    expect(Buffer.byteLength(sevenEmojis, "utf8")).toBe(28);
    const resEmojis = validateStellarMemo(sevenEmojis, "MEMO_TEXT");
    expect(resEmojis.valid).toBe(true);
    expect(resEmojis.byteLength).toBe(28);

    // 8 emojis = 32 bytes (only 8 characters in length, but exceeds 28 bytes!) -> invalid
    const eightEmojis = "😀".repeat(8);
    expect(Buffer.byteLength(eightEmojis, "utf8")).toBe(32);
    const resOver = validateStellarMemo(eightEmojis, "MEMO_TEXT");
    expect(resOver.valid).toBe(false);
    expect(resOver.error).toContain(STELLAR_MEMO_ERROR_MESSAGES.textTooLong);
    expect(resOver.error).toContain("32 bytes");
  });

  it("rejects 29 ASCII characters", () => {
    const res = validateStellarMemo("a".repeat(29), "MEMO_TEXT");
    expect(res.valid).toBe(false);
    expect(res.error).toContain(STELLAR_MEMO_ERROR_MESSAGES.textTooLong);
  });

  it("rejects control characters, newlines, and bidi overrides", () => {
    expect(validateStellarMemo("hello\nworld", "MEMO_TEXT").valid).toBe(false);
    expect(validateStellarMemo("test\u0000null", "MEMO_TEXT").valid).toBe(false);
    expect(validateStellarMemo("bidi\u202Eattack", "MEMO_TEXT").valid).toBe(false);
  });
});

describe("MEMO_ID validation (#1368)", () => {
  it("accepts valid 64-bit unsigned integers", () => {
    expect(validateStellarMemo("0", "MEMO_ID").valid).toBe(true);
    expect(validateStellarMemo("42", "MEMO_ID").valid).toBe(true);
    expect(validateStellarMemo("123456789012345", "MEMO_ID").valid).toBe(true);
    expect(validateStellarMemo(MEMO_ID_MAX.toString(), "MEMO_ID").valid).toBe(true);
  });

  it("rejects non-numeric strings, negative numbers, and floats", () => {
    expect(validateStellarMemo("abc", "MEMO_ID").valid).toBe(false);
    expect(validateStellarMemo("-1", "MEMO_ID").valid).toBe(false);
    expect(validateStellarMemo("12.34", "MEMO_ID").valid).toBe(false);
    expect(validateStellarMemo(" 123 ", "MEMO_ID").valid).toBe(true); // Trims whitespace
  });

  it("rejects values exceeding 64-bit integer limit", () => {
    const overflow = (MEMO_ID_MAX + BigInt(1)).toString();
    const res = validateStellarMemo(overflow, "MEMO_ID");
    expect(res.valid).toBe(false);
    expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.idOverflow);
  });
});

describe("MEMO_HASH and MEMO_RETURN validation (#1368)", () => {
  const validHex64 = "a".repeat(64);
  const mixedHex64 = "0123456789abcdefABCDEF0123456789abcdef0123456789abcdef0123456789";

  it("accepts 64-character hex strings for MEMO_HASH", () => {
    expect(validateStellarMemo(validHex64, "MEMO_HASH").valid).toBe(true);
    expect(validateStellarMemo(mixedHex64, "MEMO_HASH").valid).toBe(true);
  });

  it("rejects invalid length or non-hex characters for MEMO_HASH", () => {
    // 63 chars (too short)
    expect(validateStellarMemo("a".repeat(63), "MEMO_HASH").valid).toBe(false);
    // 65 chars (too long)
    expect(validateStellarMemo("a".repeat(65), "MEMO_HASH").valid).toBe(false);
    // Non-hex characters
    expect(validateStellarMemo("z".repeat(64), "MEMO_HASH").valid).toBe(false);
  });

  it("accepts 64-character hex strings for MEMO_RETURN", () => {
    expect(validateStellarMemo(validHex64, "MEMO_RETURN").valid).toBe(true);
  });

  it("rejects invalid length or non-hex characters for MEMO_RETURN", () => {
    expect(validateStellarMemo("a".repeat(63), "MEMO_RETURN").valid).toBe(false);
    expect(validateStellarMemo("g".repeat(64), "MEMO_RETURN").valid).toBe(false);
  });
});

describe("Zod schema integration (#1368)", () => {
  it("validates structured memo payloads via stellarMemoSchema", () => {
    const validText = stellarMemoSchema.safeParse({ memo: "test", memoType: "MEMO_TEXT" });
    expect(validText.success).toBe(true);

    const validHash = stellarMemoSchema.safeParse({
      memo: "b".repeat(64),
      memoType: "MEMO_HASH",
    });
    expect(validHash.success).toBe(true);

    const invalidEmoji = stellarMemoSchema.safeParse({
      memo: "🚀".repeat(8), // 32 bytes
      memoType: "MEMO_TEXT",
    });
    expect(invalidEmoji.success).toBe(false);
  });

  it("validates standalone string memos via stellarMemoField", () => {
    expect(stellarMemoField.safeParse("valid-memo").success).toBe(true);
    expect(stellarMemoField.safeParse("f".repeat(64)).success).toBe(true);
    expect(stellarMemoField.safeParse("123456789").success).toBe(true);
    expect(stellarMemoField.safeParse("a".repeat(29)).success).toBe(false);
    expect(stellarMemoField.safeParse("😀".repeat(8)).success).toBe(false);
  });
});
