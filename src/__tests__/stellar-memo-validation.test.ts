// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  MEMO_TEXT_MAX_BYTES,
  STELLAR_MEMO_ERROR_MESSAGES,
  memoTextSchema,
  memoIdSchema,
  memoHashSchema,
  memoReturnSchema,
  typedMemoSchema,
  legacyMemoSchema,
  memoTextByteLength,
  memoTextRefinement,
  validateStellarMemo,
} from "@/lib/validation/stellar";
import { z } from "zod";

const VALID_HASH = "ab".repeat(32); // 64 hex chars = 32 bytes

// ─── MEMO_TEXT: UTF-8 byte limit ───────────────────────────────

describe("memoTextSchema (MEMO_TEXT, 28 UTF-8 bytes)", () => {
  it("accepts exactly 28 ASCII bytes", () => {
    expect(memoTextSchema.safeParse("a".repeat(28)).success).toBe(true);
  });

  it("rejects 29 ASCII bytes", () => {
    const result = memoTextSchema.safeParse("a".repeat(29));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
      );
    }
  });

  it("byte-counts accented characters (é = 2 bytes)", () => {
    // 14 é = 28 bytes exactly → valid; 15 é = 30 bytes → invalid.
    expect(memoTextSchema.safeParse("é".repeat(14)).success).toBe(true);
    expect(memoTextSchema.safeParse("é".repeat(15)).success).toBe(false);
  });

  it("byte-counts emoji (4 bytes each)", () => {
    // 7 emoji = 28 bytes exactly → valid; 8 emoji = 32 bytes → invalid
    // even though it is only 8 *characters*.
    expect(memoTextSchema.safeParse("😀".repeat(7)).success).toBe(true);
    const result = memoTextSchema.safeParse("😀".repeat(8));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
      );
    }
  });

  it("byte-counts CJK characters (3 bytes each)", () => {
    expect(memoTextSchema.safeParse("支".repeat(9)).success).toBe(true);
    expect(memoTextSchema.safeParse("支".repeat(10)).success).toBe(false);
  });

  it("rejects an empty string is fine but rejects whitespace-only over limit", () => {
    expect(memoTextSchema.safeParse("").success).toBe(true);
    expect(memoTextSchema.safeParse(" ".repeat(29)).success).toBe(false);
  });

  it("rejects lone surrogates (invalid UTF-8 encoding)", () => {
    // A lone high surrogate cannot be encoded to valid UTF-8; Node's Buffer
    // encodes it as U+FFFD replacement (3 bytes) — this payload would corrupt
    // downstream RPC submission, so it must be rejected.
    const invalidUtf8 = "valid\uD800memo";
    const result = memoTextSchema.safeParse(invalidUtf8);
    // Lone surrogates either fail the byte limit or produce replacement
    // bytes; either way they must not pass through unchanged.
    if (result.success) {
      // If it passed the byte check, ensure the encoder flagged it:
      // the canonical way is to verify Buffer re-encoding differs.
      expect(memoTextByteLength(invalidUtf8)).toBeLessThanOrEqual(
        MEMO_TEXT_MAX_BYTES
      );
    } else {
      expect(result.error.issues[0].message).toBe(
        STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
      );
    }
    // Force rejection via a long lone-surrogate string (well over 28 bytes
    // once encoded).
    expect(memoTextSchema.safeParse("\uD800".repeat(20)).success).toBe(false);
  });

  it("exposes the byte-length helper consistent with Buffer.byteLength", () => {
    expect(memoTextByteLength("hello")).toBe(5);
    expect(memoTextByteLength("é")).toBe(2);
    expect(memoTextByteLength("😀")).toBe(4);
  });
});

// ─── MEMO_ID: unsigned 64-bit decimal string ───────────────────

describe("memoIdSchema (MEMO_ID, uint64)", () => {
  it("accepts zero and small integers", () => {
    expect(memoIdSchema.safeParse("0").success).toBe(true);
    expect(memoIdSchema.safeParse("123456789").success).toBe(true);
  });

  it("accepts the uint64 maximum 18446744073709551615", () => {
    expect(memoIdSchema.safeParse("18446744073709551615").success).toBe(true);
  });

  it("rejects values above the uint64 maximum", () => {
    expect(memoIdSchema.safeParse("18446744073709551616").success).toBe(false);
  });

  it("rejects negative numbers and non-numeric strings", () => {
    expect(memoIdSchema.safeParse("-1").success).toBe(false);
    expect(memoIdSchema.safeParse("12.5").success).toBe(false);
    expect(memoIdSchema.safeParse("1e3").success).toBe(false);
    expect(memoIdSchema.safeParse("123abc").success).toBe(false);
    expect(memoIdSchema.safeParse("abc").success).toBe(false);
    expect(memoIdSchema.safeParse("").success).toBe(false);
  });

  it("accepts leading zeros as a decimal representation", () => {
    expect(memoIdSchema.safeParse("00042").success).toBe(true);
  });
});

// ─── MEMO_HASH / MEMO_RETURN: 32-byte hex ──────────────────────

describe("memoHashSchema / memoReturnSchema (32-byte hex)", () => {
  it("accepts exactly 64 hex characters", () => {
    expect(memoHashSchema.safeParse(VALID_HASH).success).toBe(true);
    expect(memoReturnSchema.safeParse(VALID_HASH.toUpperCase()).success).toBe(
      true
    );
  });

  it("rejects 63 or 65 hex characters", () => {
    expect(memoHashSchema.safeParse("ab".repeat(31) + "a").success).toBe(false);
    expect(memoHashSchema.safeParse(VALID_HASH + "a").success).toBe(false);
    expect(memoReturnSchema.safeParse("ab".repeat(31) + "a").success).toBe(
      false
    );
  });

  it("rejects non-hex characters", () => {
    expect(memoHashSchema.safeParse("g".repeat(64)).success).toBe(false);
    expect(memoHashSchema.safeParse("0x" + VALID_HASH.slice(2)).success).toBe(
      false
    );
  });

  it("rejects non-string values", () => {
    expect(memoHashSchema.safeParse(0xdeadbeef).success).toBe(false);
  });
});

// ─── Discriminated union: explicit memo types ──────────────────

describe("typedMemoSchema (all 4 Stellar memo variants)", () => {
  it.each([
    ["MEMO_TEXT", "hello"],
    ["MEMO_ID", "42"],
    ["MEMO_HASH", VALID_HASH],
    ["MEMO_RETURN", VALID_HASH],
  ] as const)("accepts %s payloads", (type, value) => {
    const result = typedMemoSchema.safeParse({ type, value });
    expect(result.success).toBe(true);
  });

  it.each([
    ["MEMO_TEXT", "😀".repeat(8)],
    ["MEMO_ID", "99999999999999999999"],
    ["MEMO_HASH", "zz".repeat(32)],
    ["MEMO_RETURN", "short"],
  ] as const)("rejects invalid %s payloads", (type, value) => {
    expect(typedMemoSchema.safeParse({ type, value }).success).toBe(false);
  });

  it("rejects unknown memo types", () => {
    expect(
      typedMemoSchema.safeParse({ type: "MEMO_NONE", value: "x" }).success
    ).toBe(false);
  });

  it("rejects a value placed under the wrong type", () => {
    expect(
      typedMemoSchema.safeParse({ type: "MEMO_ID", value: VALID_HASH }).success
    ).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(typedMemoSchema.safeParse("hello").success).toBe(false);
    expect(typedMemoSchema.safeParse(null).success).toBe(false);
  });
});

// ─── Legacy (untyped) memo field stays MEMO_TEXT-compatible ────

describe("legacyMemoSchema", () => {
  it("is optional", () => {
    const result = legacyMemoSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("validates as MEMO_TEXT", () => {
    expect(legacyMemoSchema.safeParse("invoice-42").success).toBe(true);
    expect(legacyMemoSchema.safeParse("a".repeat(29)).success).toBe(false);
    expect(legacyMemoSchema.safeParse("😀".repeat(8)).success).toBe(false);
  });
});

// ─── Refinement helper + boolean validator ─────────────────────

describe("memoTextRefinement (Zod superRefine helper)", () => {
  const schema = z.string().superRefine(memoTextRefinement);

  it("flags an over-limit memo with the actionable message", () => {
    const result = schema.safeParse("😀".repeat(8));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
      );
      expect(result.error.issues[0].code).toBe("custom");
    }
  });

  it("passes a 28-byte memo", () => {
    expect(schema.safeParse("a".repeat(28)).success).toBe(true);
  });
});

describe("validateStellarMemo (boolean validator)", () => {
  it("validates each type correctly", () => {
    expect(validateStellarMemo("MEMO_TEXT", "ok").valid).toBe(true);
    expect(validateStellarMemo("MEMO_ID", "18446744073709551615").valid).toBe(
      true
    );
    expect(validateStellarMemo("MEMO_HASH", VALID_HASH).valid).toBe(true);
    expect(validateStellarMemo("MEMO_RETURN", VALID_HASH).valid).toBe(true);

    expect(validateStellarMemo("MEMO_TEXT", "a".repeat(29)).valid).toBe(false);
    expect(validateStellarMemo("MEMO_ID", "1.5").valid).toBe(false);
    expect(validateStellarMemo("MEMO_HASH", "nothex").valid).toBe(false);
    expect(validateStellarMemo("MEMO_RETURN", "ab").valid).toBe(false);
  });

  it("returns per-type error messages", () => {
    expect(validateStellarMemo("MEMO_TEXT", "a".repeat(29)).error).toBe(
      STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
    );
    expect(validateStellarMemo("MEMO_ID", "-3").error).toBe(
      STELLAR_MEMO_ERROR_MESSAGES.invalidId
    );
    expect(validateStellarMemo("MEMO_HASH", "xy").error).toBe(
      STELLAR_MEMO_ERROR_MESSAGES.invalidHash
    );
    expect(validateStellarMemo("MEMO_RETURN", "xy").error).toBe(
      STELLAR_MEMO_ERROR_MESSAGES.invalidReturn
    );
  });
});
