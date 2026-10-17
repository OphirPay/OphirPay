// SPDX-License-Identifier: MIT

/**
 * Stellar memo encoding validation (issue #1368).
 *
 * Four variants, each with its own shape and failure mode:
 *
 *   MEMO_TEXT   — ≤ 28 **UTF-8 bytes** (not characters)
 *   MEMO_ID     — unsigned 64-bit integer, full range
 *   MEMO_HASH   — exactly 32 bytes, expressed as 64 hex characters
 *   MEMO_RETURN — same wire form as MEMO_HASH
 *
 * The byte-count cases are the reason this exists: a memo that is short in
 * characters can still be over Stellar's limit in bytes, and the failure used
 * to appear at Horizon submission time rather than at the API boundary.
 */

import { describe, it, expect } from "vitest";
import {
  MEMO_ID_MAX,
  isWellFormedUnicode,
  resolveMemoType,
  stellarMemoTypeSchema,
  utf8ByteLength,
  validateStellarMemo,
} from "@/lib/validation/stellar";
import {
  MEMO_ERROR_MESSAGES,
  createBatchSchema,
  createPaymentRequestSchema,
  createPaymentSchema,
  updatePaymentSchema,
} from "@/lib/validation-schemas";

const VALID_STELLAR = "G" + "A".repeat(55);
const VALID_HASH = "0123456789abcdef".repeat(4); // 64 hex chars

const paymentBase = {
  amount: 10,
  sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
  destAddress: VALID_STELLAR,
};

// ── Byte counting ─────────────────────────────────────────────

describe("UTF-8 byte counting", () => {
  it("counts ASCII as one byte per character", () => {
    expect(utf8ByteLength("hello")).toBe(5);
    expect(utf8ByteLength("a".repeat(28))).toBe(28);
  });

  it("counts accented characters as their multi-byte UTF-8 width", () => {
    // C(1) + à(2) + space(1) + p(1) + h(1) + ê(2) = 8 bytes
    expect(utf8ByteLength("Cà phê")).toBe(8);
  });

  it("counts emoji as four bytes each", () => {
    expect(utf8ByteLength("🚀")).toBe(4);
    expect(utf8ByteLength("🚀".repeat(7))).toBe(28);
    expect(utf8ByteLength("🚀".repeat(8))).toBe(32);
  });

  it("flags unpaired surrogates, which TextEncoder would silently replace", () => {
    expect(isWellFormedUnicode("ok")).toBe(true);
    expect(isWellFormedUnicode("🚀")).toBe(true);
    expect(isWellFormedUnicode("\uD800")).toBe(false);
    expect(isWellFormedUnicode("a\uDC00b")).toBe(false);
  });
});

// ── MEMO_TEXT ─────────────────────────────────────────────────

describe("MEMO_TEXT", () => {
  it("accepts printable text at and below the 28-byte boundary", () => {
    expect(validateStellarMemo("invoice-42", "MEMO_TEXT")).toBeNull();
    expect(validateStellarMemo("a".repeat(28), "MEMO_TEXT")).toBeNull();
    expect(validateStellarMemo("🚀".repeat(7), "MEMO_TEXT")).toBeNull();
  });

  it("treats the empty string as 'no memo'", () => {
    expect(validateStellarMemo("", "MEMO_TEXT")).toBeNull();
  });

  it("rejects text longer than 28 characters", () => {
    const issue = validateStellarMemo("a".repeat(29), "MEMO_TEXT");
    expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.tooLong);
    expect(issue?.code).toBe("MEMO_TOO_LONG");
  });

  it("rejects ≤ 28 characters that exceed 28 UTF-8 bytes", () => {
    // 8 emoji = 16 UTF-16 code units (under the character limit) but 32 UTF-8
    // bytes — exactly the case a `.length` check lets through.
    const text = "😀".repeat(8);
    expect(text.length).toBeLessThanOrEqual(28);
    expect(utf8ByteLength(text)).toBe(32);

    const issue = validateStellarMemo(text, "MEMO_TEXT");
    expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
    expect(issue?.code).toBe("MEMO_TOO_LONG");
  });

  it("rejects control, zero-width and bidi-override characters", () => {
    expect(validateStellarMemo("line1\nline2", "MEMO_TEXT")?.message).toBe(
      MEMO_ERROR_MESSAGES.controlChars
    );
    expect(validateStellarMemo("zero\u200Bwidth", "MEMO_TEXT")?.message).toBe(
      MEMO_ERROR_MESSAGES.controlChars
    );
    expect(validateStellarMemo("rtl\u202Eoverride", "MEMO_TEXT")?.message).toBe(
      MEMO_ERROR_MESSAGES.controlChars
    );
  });

  it("rejects an unpaired surrogate", () => {
    expect(validateStellarMemo("bad\uD800", "MEMO_TEXT")?.code).toBe(
      "INVALID_MEMO"
    );
  });

  it("defaults to MEMO_TEXT when no type is given", () => {
    expect(resolveMemoType(undefined)).toBe("MEMO_TEXT");
    expect(validateStellarMemo("a".repeat(29))?.code).toBe("MEMO_TOO_LONG");
  });
});

// ── MEMO_ID ───────────────────────────────────────────────────

describe("MEMO_ID", () => {
  it("accepts the full unsigned 64-bit range", () => {
    expect(validateStellarMemo("0", "MEMO_ID")).toBeNull();
    expect(validateStellarMemo("123456789", "MEMO_ID")).toBeNull();
    // The boundary that a float-based check got wrong.
    expect(validateStellarMemo("18446744073709551615", "MEMO_ID")).toBeNull();
    expect(MEMO_ID_MAX).toBe(BigInt("18446744073709551615"));
  });

  it("rejects a value one past the 64-bit maximum", () => {
    const issue = validateStellarMemo("18446744073709551616", "MEMO_ID");
    expect(issue?.code).toBe("MEMO_TOO_LONG");
    expect(issue?.message).toContain("64-bit");
  });

  it("rejects signs, decimals and exponents", () => {
    for (const value of ["-1", "+1", "1.5", "1e3", " 12", ""]) {
      if (value === "") continue; // empty means "no memo"
      expect(
        validateStellarMemo(value, "MEMO_ID"),
        `expected ${JSON.stringify(value)} to be rejected`
      ).not.toBeNull();
    }
  });

  it("rejects trailing text that parseFloat used to swallow", () => {
    expect(validateStellarMemo("123abc", "MEMO_ID")?.code).toBe(
      "MEMO_INVALID_FORMAT"
    );
    expect(validateStellarMemo("0x10", "MEMO_ID")?.code).toBe(
      "MEMO_INVALID_FORMAT"
    );
  });
});

// ── MEMO_HASH / MEMO_RETURN ───────────────────────────────────

describe("MEMO_HASH and MEMO_RETURN", () => {
  it("accepts exactly 64 hexadecimal characters", () => {
    expect(validateStellarMemo(VALID_HASH, "MEMO_HASH")).toBeNull();
    expect(validateStellarMemo(VALID_HASH, "MEMO_RETURN")).toBeNull();
    expect(validateStellarMemo(VALID_HASH.toUpperCase(), "MEMO_HASH")).toBeNull();
  });

  it("rejects a hash of the wrong length, reporting what it received", () => {
    const short = validateStellarMemo("abcdef", "MEMO_HASH");
    expect(short?.code).toBe("MEMO_INVALID_FORMAT");
    expect(short?.message).toContain("received 6");
    // 64 UTF-8 bytes of text is a valid-looking length but not a hash.
    const long = validateStellarMemo("a".repeat(65), "MEMO_RETURN");
    expect(long?.message).toContain("received 65");
  });

  it("rejects non-hexadecimal characters", () => {
    expect(validateStellarMemo("z".repeat(64), "MEMO_HASH")?.message).toContain(
      "non-hexadecimal"
    );
    expect(validateStellarMemo("g".repeat(64), "MEMO_RETURN")?.code).toBe(
      "MEMO_INVALID_FORMAT"
    );
  });
});

// ── memoType parsing ──────────────────────────────────────────

describe("memoType", () => {
  it("accepts the canonical Stellar names", () => {
    for (const type of [
      "MEMO_TEXT",
      "MEMO_ID",
      "MEMO_HASH",
      "MEMO_RETURN",
    ] as const) {
      expect(stellarMemoTypeSchema.parse(type)).toBe(type);
    }
  });

  it("accepts the lowercase aliases used by src/lib/memo.ts and normalizes them", () => {
    expect(stellarMemoTypeSchema.parse("text")).toBe("MEMO_TEXT");
    expect(stellarMemoTypeSchema.parse(" id ")).toBe("MEMO_ID");
    expect(stellarMemoTypeSchema.parse("hash")).toBe("MEMO_HASH");
    expect(stellarMemoTypeSchema.parse("return")).toBe("MEMO_RETURN");
  });

  it("rejects an unknown memo type with an actionable message", () => {
    const result = stellarMemoTypeSchema.safeParse("MEMO_BINARY");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("memoType must be one of");
    }
  });
});

// ── Route schemas ─────────────────────────────────────────────

describe("createPaymentSchema", () => {
  it("keeps text-only clients working with no memoType", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "invoice-42",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.memo).toBe("invoice-42");
    expect(result.success && result.data.memoType).toBeUndefined();
  });

  it("accepts all four variants when memoType is explicit", () => {
    const cases = [
      { memo: "Payment for order 123", memoType: "MEMO_TEXT" },
      { memo: "9876543210", memoType: "MEMO_ID" },
      { memo: VALID_HASH, memoType: "MEMO_HASH" },
      { memo: VALID_HASH, memoType: "MEMO_RETURN" },
    ];
    for (const c of cases) {
      expect(createPaymentSchema.safeParse({ ...paymentBase, ...c }).success).toBe(
        true
      );
    }
  });

  it("rejects an invalid ID/hash with the variant's own message", () => {
    const id = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "123abc",
      memoType: "MEMO_ID",
    });
    expect(id.success).toBe(false);
    if (!id.success) {
      expect(id.error.issues[0].path).toEqual(["memo"]);
      expect(id.error.issues[0].message).toContain("unsigned whole number");
    }

    const hash = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "short",
      memoType: "MEMO_HASH",
    });
    expect(hash.success).toBe(false);
    if (!hash.success) {
      expect(hash.error.issues[0].message).toContain("64 hexadecimal characters");
    }
  });

  it("rejects oversized text through the schema path (before persistence)", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "😀".repeat(8),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        MEMO_ERROR_MESSAGES.tooManyBytes
      );
    }
  });

  it("rejects a memoType with no memo to describe", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memoType: "MEMO_ID",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("without a memo value");
    }
  });
});

describe("other routes that accept a memo", () => {
  it("updatePaymentSchema applies the same type-aware rules", () => {
    expect(
      updatePaymentSchema.safeParse({ memo: VALID_HASH, memoType: "MEMO_HASH" })
        .success
    ).toBe(true);
    expect(
      updatePaymentSchema.safeParse({ memo: "nope", memoType: "MEMO_RETURN" })
        .success
    ).toBe(false);
  });

  it("createPaymentRequestSchema validates an exchange deposit reference", () => {
    const ok = createPaymentRequestSchema.safeParse({
      amount: 25,
      memo: "1234567890",
      memoType: "MEMO_ID",
    });
    expect(ok.success).toBe(true);

    const bad = createPaymentRequestSchema.safeParse({
      amount: 25,
      memo: "😀".repeat(8),
      memoType: "MEMO_TEXT",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].message).toBe(
        MEMO_ERROR_MESSAGES.tooManyBytes
      );
    }
  });

  it("createBatchSchema validates each recipient's memo independently", () => {
    const result = createBatchSchema.safeParse({
      name: "Payroll",
      sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      recipients: [
        { address: VALID_STELLAR, amount: 10, memo: "ok-1" },
        {
          address: VALID_STELLAR,
          amount: 10,
          memo: VALID_HASH,
          memoType: "MEMO_HASH",
        },
        { address: VALID_STELLAR, amount: 10, memo: "bad", memoType: "MEMO_ID" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["recipients", 2, "memo"]);
    }
  });
});
