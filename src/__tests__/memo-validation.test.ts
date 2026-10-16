// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createPaymentSchema,
  updatePaymentSchema,
  createPaymentRequestSchema,
  createBatchSchema,
  proposeMultisigPaymentSchema,
  MEMO_ERROR_MESSAGES,
} from "@/lib/validation-schemas";
import {
  validateStellarMemo,
  stellarMemoSchema,
  STELLAR_MEMO_ERROR_MESSAGES,
  getMemoByteLength,
  normalizeStellarMemoType,
} from "@/lib/validation/stellar";
import { validateMemo } from "@/lib/validation-helpers";
import { validateMemo as validateMemoTyped } from "@/lib/memo";
import { toCsvString } from "@/lib/export-csv";
import { getMemoErrorMessage } from "@/lib/stellar";

// Valid 56-char Stellar address (G + 55 alphanumeric chars)
const VALID_STELLAR = "G" + "A".repeat(55);

const paymentBase = {
  amount: 10,
  sourceAccountId: "user-1",
  destAddress: VALID_STELLAR,
};

// ─── Server-side memoField (Zod) ───────────────────────────────

describe("memoField (server-side validation)", () => {
  it("accepts a memo with no memo present", () => {
    const result = createPaymentSchema.safeParse(paymentBase);
    expect(result.success).toBe(true);
    expect(result.success && result.data.memo).toBeUndefined();
  });

  it("accepts a short printable memo", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "invoice-42",
    });
    expect(result.success).toBe(true);
  });

  it("accepts exactly 28 ASCII characters", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "a".repeat(28),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a memo longer than 28 characters with a user-facing message", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "a".repeat(29),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "memo");
      expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.tooLong);
    }
  });

  it("rejects a memo that fits in 28 chars but exceeds 28 UTF-8 bytes", () => {
    // 8 emojis = 32 bytes (4 bytes each) but only 8 characters.
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "😀".repeat(8),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "memo");
      expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
    }
  });

  it("accepts a memo that fits within 28 UTF-8 bytes", () => {
    // 7 emojis = 28 bytes exactly.
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "😀".repeat(7),
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["newline", "line1\nline2"],
    ["tab", "a\tb"],
    ["NUL", "a\u0000b"],
    ["ESC", "\u001b[31m"],
    ["C1 control", "a\u0085b"],
    ["bidi override", "pay\u202Enow"],
    ["bidi isolate", "\u2066visa\u2069"],
    ["zero-width", "pay\u200Bnow"],
  ])("rejects %s characters in a memo", (_name, memo) => {
    const result = createPaymentSchema.safeParse({ ...paymentBase, memo });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "memo");
      expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.controlChars);
    }
  });

  it("trims surrounding whitespace before storing", () => {
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: "  invoice-42  ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("invoice-42");
  });

  it("rejects a memo of only whitespace after trimming when it is too long", () => {
    // 30 spaces trim to "" → valid (memo becomes empty).
    const result = createPaymentSchema.safeParse({
      ...paymentBase,
      memo: " ".repeat(30),
    });
    expect(result.success).toBe(true);
  });

  it("applies the same rules to batch recipients", () => {
    const ok = createBatchSchema.safeParse({
      name: "payroll",
      recipients: [{ address: VALID_STELLAR, amount: 5, memo: "ok" }],
      sourceAccountId: "user-1",
    });
    expect(ok.success).toBe(true);

    const bad = createBatchSchema.safeParse({
      name: "payroll",
      recipients: [{ address: VALID_STELLAR, amount: 5, memo: "😀".repeat(8) }],
      sourceAccountId: "user-1",
    });
    expect(bad.success).toBe(false);
  });

  it("applies the same rules to multisig proposals", () => {
    const bad = proposeMultisigPaymentSchema.safeParse({
      payee: VALID_STELLAR,
      amount: 5,
      memo: "bad\u0007memo",
    });
    expect(bad.success).toBe(false);
  });

  it("updatePaymentSchema accepts every status the PATCH route dispatches webhooks for", () => {
    for (const status of ["SIGNED", "SUBMITTED", "CONFIRMED", "COMPLETED", "FAILED", "CANCELLED"]) {
      const result = updatePaymentSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it("updatePaymentSchema rejects an invalid memo", () => {
    const result = updatePaymentSchema.safeParse({ memo: "line1\nline2" });
    expect(result.success).toBe(false);
  });
});

// ─── UI-side validateMemo helper ───────────────────────────────

describe("validateMemo (UI helper)", () => {
  it("returns null for empty and short memos", () => {
    expect(validateMemo("")).toBeNull();
    expect(validateMemo("payment-123")).toBeNull();
  });

  it("keeps the existing message for > 28 characters", () => {
    expect(validateMemo("a".repeat(29))).toBe(
      "Memo must be 28 characters or fewer"
    );
  });

  it("rejects control characters", () => {
    expect(validateMemo("a\nb")).toBe(
      "Memo must not contain control or invisible characters"
    );
    expect(validateMemo("a\u0000b")).toBe(
      "Memo must not contain control or invisible characters"
    );
  });

  it("rejects multibyte memos over 28 bytes", () => {
    expect(validateMemo("😀".repeat(8))).toBe(
      "Memo must be 28 bytes or fewer (non-ASCII characters count more)"
    );
  });

  it("accepts exactly 28 ASCII characters", () => {
    expect(validateMemo("a".repeat(28))).toBeNull();
  });
});

// ─── Type-aware memo validator (memo.ts) ───────────────────────

describe("validateMemo (type-aware)", () => {
  it("rejects control characters in text memos", () => {
    expect(validateMemoTyped("line1\nline2").valid).toBe(false);
    expect(validateMemoTyped("a\u0000b").valid).toBe(false);
  });

  it("still validates byte length for text memos", () => {
    expect(validateMemoTyped("😀".repeat(8)).valid).toBe(false);
    expect(validateMemoTyped("😀".repeat(7)).valid).toBe(true);
  });

  it("still accepts id / hash / return memo types", () => {
    expect(validateMemoTyped("123456789", "id").valid).toBe(true);
    expect(validateMemoTyped("a".repeat(64), "hash").valid).toBe(true);
    expect(validateMemoTyped("a".repeat(64), "return").valid).toBe(true);
  });
});

// ─── CSV export formula-injection guard ────────────────────────

describe("CSV export formula-injection guard", () => {
  const cols = [{ key: "memo" as const, header: "Memo" }];

  const csvFor = (memo: string) =>
    toCsvString([{ memo }], cols);

  it("neutralizes = formulas", () => {
    expect(csvFor("=HYPERLINK(\"http://evil\")")).toContain(
      "'=HYPERLINK"
    );
  });

  it("neutralizes +, -, and @ prefixes", () => {
    expect(csvFor("+SUM(A1:A2)")).toContain("'+SUM");
    expect(csvFor("-1+2")).toContain("'-1+2");
    expect(csvFor("@cmd")).toContain("'@cmd");
  });

  it("leaves normal memos untouched", () => {
    expect(csvFor("invoice-42")).toBe("Memo\ninvoice-42");
    expect(csvFor("thanks!")).toBe("Memo\nthanks!");
  });

  it("guards fields that also need quoting", () => {
    // Quote-worthy (comma) AND formula-prefixed → both handled.
    const out = csvFor("=1,2");
    expect(out).toContain("'=1,2");
    expect(out).toContain('"');
  });
});

// ─── getMemoErrorMessage (from stellar.ts, used by send page via parseSubmissionError) ──

describe("getMemoErrorMessage", () => {
  it("returns null for non-memo errors", () => {
    expect(getMemoErrorMessage("op_underfunded")).toBeNull();
    expect(getMemoErrorMessage("insufficient balance")).toBeNull();
    expect(getMemoErrorMessage("network timeout")).toBeNull();
  });

  it("maps tx_memo_required to friendly memo-required message", () => {
    const msg = getMemoErrorMessage("tx_memo_required");
    expect(msg).toBe("This account requires a memo to receive payments. Please add a memo.");
  });

  it("maps tx_memo_required embedded in a Horizon error string", () => {
    const msg = getMemoErrorMessage("Transaction failed: tx_memo_required — destination requires a memo");
    expect(msg).toContain("requires a memo");
  });

  it("maps 'memo too long' error", () => {
    const msg = getMemoErrorMessage("tx_memo_too_long: memo exceeds maximum length");
    expect(msg).toContain("too long");
    expect(msg).toContain("28 bytes");
  });

  it("maps 'memo invalid' error", () => {
    const msg = getMemoErrorMessage("tx_bad_memo: memo is invalid");
    expect(msg).toContain("Invalid memo format");
  });

  it("maps 'tx_bad_memo' error", () => {
    const msg = getMemoErrorMessage("tx_bad_memo_type");
    expect(msg).toContain("invalid memo");
  });

  it("maps 'op_bad_memo' error", () => {
    const msg = getMemoErrorMessage("op_bad_memo: bad memo in operation");
    expect(msg).toContain("memo format is invalid");
  });

  it("is case-insensitive", () => {
    const msg = getMemoErrorMessage("TX_MEMO_TOO_LONG: memo exceeds maximum length");
    expect(msg).toContain("too long");
  });
});

// ─── Stellar Memo Encoding & 4 Variant Types (Issue #1368) ─────

describe("Stellar Memo Validation & 4 Variants (src/lib/validation/stellar.ts)", () => {
  describe("getMemoByteLength & normalizeStellarMemoType", () => {
    it("correctly calculates byte length for ASCII and UTF-8 multibyte characters", () => {
      expect(getMemoByteLength("hello")).toBe(5);
      expect(getMemoByteLength("café")).toBe(5); // 'é' is 2 bytes
      expect(getMemoByteLength("😀")).toBe(4); // emoji is 4 bytes
      expect(getMemoByteLength("😀".repeat(7))).toBe(28);
      expect(getMemoByteLength("😀".repeat(8))).toBe(32);
    });

    it("normalizes memo types case-insensitively and maps aliases", () => {
      expect(normalizeStellarMemoType("MEMO_TEXT")).toBe("MEMO_TEXT");
      expect(normalizeStellarMemoType("text")).toBe("MEMO_TEXT");
      expect(normalizeStellarMemoType("MEMO_ID")).toBe("MEMO_ID");
      expect(normalizeStellarMemoType("id")).toBe("MEMO_ID");
      expect(normalizeStellarMemoType("MEMO_HASH")).toBe("MEMO_HASH");
      expect(normalizeStellarMemoType("hash")).toBe("MEMO_HASH");
      expect(normalizeStellarMemoType("MEMO_RETURN")).toBe("MEMO_RETURN");
      expect(normalizeStellarMemoType("return")).toBe("MEMO_RETURN");
      expect(normalizeStellarMemoType(undefined)).toBe("MEMO_TEXT");
    });
  });

  describe("Variant 1: MEMO_TEXT", () => {
    it("accepts valid ASCII within 28 bytes", () => {
      const res = validateStellarMemo("invoice-10294", "MEMO_TEXT");
      expect(res.valid).toBe(true);
      expect(res.type).toBe("MEMO_TEXT");
      expect(res.byteLength).toBe(13);
    });

    it("accepts exactly 28 UTF-8 bytes with multibyte characters", () => {
      const res = validateStellarMemo("😀".repeat(7), "MEMO_TEXT");
      expect(res.valid).toBe(true);
      expect(res.byteLength).toBe(28);
    });

    it("rejects text exceeding 28 characters with tooLong error", () => {
      const res = validateStellarMemo("a".repeat(29), "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.tooLong);
    });

    it("rejects multibyte text fitting in 28 chars but exceeding 28 bytes with tooManyBytes error", () => {
      const res = validateStellarMemo("😀".repeat(8), "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes);
    });

    it("rejects control characters in text memo", () => {
      const res = validateStellarMemo("line1\nline2", "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.controlChars);
    });
  });

  describe("Variant 2: MEMO_ID", () => {
    it("accepts valid 64-bit unsigned integer values", () => {
      expect(validateStellarMemo("0", "MEMO_ID").valid).toBe(true);
      expect(validateStellarMemo("123456789", "MEMO_ID").valid).toBe(true);
      expect(validateStellarMemo("18446744073709551615", "MEMO_ID").valid).toBe(true); // uint64 max
    });

    it("rejects negative numbers", () => {
      const res = validateStellarMemo("-1", "MEMO_ID");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidId);
    });

    it("rejects non-numeric strings", () => {
      const res = validateStellarMemo("not-a-number", "MEMO_ID");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidId);
    });

    it("rejects numbers exceeding 64-bit unsigned integer limit", () => {
      const res = validateStellarMemo("18446744073709551616", "MEMO_ID"); // 2^64
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidId);
    });
  });

  describe("Variant 3: MEMO_HASH", () => {
    const validHash = "a".repeat(64);
    const validHexMixed = "0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789ABCDEF";

    it("accepts 64-character hexadecimal strings", () => {
      expect(validateStellarMemo(validHash, "MEMO_HASH").valid).toBe(true);
      expect(validateStellarMemo(validHexMixed, "MEMO_HASH").valid).toBe(true);
    });

    it("rejects hashes shorter than 64 characters", () => {
      const res = validateStellarMemo("a".repeat(63), "MEMO_HASH");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidHash);
    });

    it("rejects hashes longer than 64 characters", () => {
      const res = validateStellarMemo("a".repeat(65), "MEMO_HASH");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidHash);
    });

    it("rejects non-hexadecimal characters", () => {
      const res = validateStellarMemo("g".repeat(64), "MEMO_HASH");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidHash);
    });
  });

  describe("Variant 4: MEMO_RETURN", () => {
    const validReturn = "f".repeat(64);

    it("accepts 64-character hexadecimal strings", () => {
      expect(validateStellarMemo(validReturn, "MEMO_RETURN").valid).toBe(true);
    });

    it("rejects invalid return hashes", () => {
      const res = validateStellarMemo("invalid-hex", "MEMO_RETURN");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidReturn);
    });
  });

  describe("Unsupported memo types", () => {
    it("rejects unknown memo types with an actionable error message", () => {
      const res = validateStellarMemo("test", "MEMO_INVALID");
      expect(res.valid).toBe(false);
      expect(res.error).toContain(STELLAR_MEMO_ERROR_MESSAGES.unsupportedType);
    });
  });

  describe("Route integration schemas", () => {
    it("createPaymentSchema validates all 4 variants", () => {
      // MEMO_TEXT valid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "invoice-42", memoType: "MEMO_TEXT" }).success).toBe(true);
      // MEMO_TEXT invalid (too long)
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "a".repeat(29), memoType: "MEMO_TEXT" }).success).toBe(false);
      // MEMO_ID valid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "987654321", memoType: "MEMO_ID" }).success).toBe(true);
      // MEMO_ID invalid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "-5", memoType: "MEMO_ID" }).success).toBe(false);
      // MEMO_HASH valid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "a".repeat(64), memoType: "MEMO_HASH" }).success).toBe(true);
      // MEMO_HASH invalid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "not-hex", memoType: "MEMO_HASH" }).success).toBe(false);
      // MEMO_RETURN valid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "f".repeat(64), memoType: "MEMO_RETURN" }).success).toBe(true);
      // MEMO_RETURN invalid
      expect(createPaymentSchema.safeParse({ ...paymentBase, memo: "not-hex", memoType: "MEMO_RETURN" }).success).toBe(false);
    });

    it("createPaymentRequestSchema validates memos and rejects oversized memos", () => {
      const validReq = createPaymentRequestSchema.safeParse({
        amount: 50,
        memo: "request-123",
        memoType: "MEMO_TEXT",
      });
      expect(validReq.success).toBe(true);

      const invalidReq = createPaymentRequestSchema.safeParse({
        amount: 50,
        memo: "😀".repeat(8),
        memoType: "MEMO_TEXT",
      });
      expect(invalidReq.success).toBe(false);
    });

    it("stellarMemoSchema standalone Zod validation validates byte length and charsets", () => {
      expect(stellarMemoSchema.safeParse("valid-memo").success).toBe(true);
      expect(stellarMemoSchema.safeParse("😀".repeat(7)).success).toBe(true);
      expect(stellarMemoSchema.safeParse("😀".repeat(8)).success).toBe(false);
      expect(stellarMemoSchema.safeParse("a".repeat(29)).success).toBe(false);
      expect(stellarMemoSchema.safeParse("bad\u0000char").success).toBe(false);
    });
  });
});
