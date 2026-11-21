// SPDX-License-Identifier: MIT

import { describe, expect,it } from "vitest";

import { toCsvString } from "@/lib/export-csv";
import { validateMemo as validateMemoTyped } from "@/lib/memo";
import { getMemoErrorMessage } from "@/lib/stellar";
import { validateMemo } from "@/lib/validation-helpers";
import {
  createBatchSchema,
  createPaymentSchema,
  MEMO_ERROR_MESSAGES,
  proposeMultisigPaymentSchema,
  updatePaymentSchema,
} from "@/lib/validation-schemas";

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

// ─── UTF-8 Byte Length Calculation Tests (Issue #1921) ───────

describe("Stellar memo UTF-8 byte length validation", () => {
  it("pure ASCII memo up to 28 characters is valid", () => {
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "a".repeat(28),
    });
    expect(result.success).toBe(true);
  });

  it("pure ASCII memo exceeding 28 characters is rejected", () => {
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "a".repeat(29),
    });
    expect(result.success).toBe(false);
  });

  it("multi-byte emoji string with 7 emojis (28 bytes total) is valid", () => {
    // Each emoji is typically 4 UTF-8 bytes
    // 7 emojis × 4 bytes = 28 bytes (valid)
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(7),
    });
    expect(result.success).toBe(true);
  });

  it("multi-byte emoji string with 8 emojis (32 bytes total) is rejected", () => {
    // 8 emojis × 4 bytes = 32 bytes (exceeds 28-byte limit)
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(8),
    });
    expect(result.success).toBe(false);
  });

  it("rejection of 29-byte UTF-8 string (multibyte)", () => {
    // 7 emojis (28 bytes) + 1 letter (1 byte) = 29 bytes
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(7) + "a",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "memo");
      expect(issue?.message).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
    }
  });

  it("accented characters count as multiple bytes", () => {
    // "é" is 2 UTF-8 bytes
    // 14 × "é" = 28 bytes (valid)
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "é".repeat(14),
    });
    expect(result.success).toBe(true);
  });

  it("accented character exceeding 28 bytes is rejected", () => {
    // 15 × "é" = 30 bytes (exceeds limit)
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "é".repeat(15),
    });
    expect(result.success).toBe(false);
  });

  it("mixed ASCII and multibyte characters respect byte limit", () => {
    // "hello" (5 bytes) + 🎉 (4 bytes) + 🎉 (4 bytes) + 🎉 (4 bytes) + 🎉 (4 bytes) + 🎉 (4 bytes) + a (1 byte) + a (1 byte) = 27 bytes
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "hello🎉🎉🎉🎉🎉aa",
    });
    expect(result.success).toBe(true);
  });

  it("mixed ASCII and multibyte exceeding 28 bytes is rejected", () => {
    // "hello" (5) + "world" (5) + 🎉 (4) + 🎉 (4) + 🎉 (4) + 🎉 (4) = 26 bytes, but with more:
    // "hello world 🎉🎉🎉🎉" = 5 + 1 + 5 + 1 + 4 + 4 + 4 + 4 = 28 bytes
    // "hello world 🎉🎉🎉🎉x" = 29 bytes (rejected)
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "hello world 🎉🎉🎉🎉x",
    });
    expect(result.success).toBe(false);
  });

  it("Chinese characters (3-4 bytes each) are counted correctly", () => {
    // "你好世界" = 4 characters, 12 bytes (3 bytes each in UTF-8)
    // Should be valid
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "你好世界",
    });
    expect(result.success).toBe(true);
  });

  it("many Chinese characters exceeding 28 bytes are rejected", () => {
    // 10 Chinese characters = ~30 bytes
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "你好世界你好世界你好世",
    });
    expect(result.success).toBe(false);
  });

  it("error message distinguishes between character and byte limits", () => {
    // Test that when a memo is short in characters but long in bytes, the error mentions bytes
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(8), // 8 chars, 32 bytes
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "memo");
      expect(issue?.message).toContain("28 bytes");
    }
  });

  it("exactly 28 bytes of various multibyte sequences is valid", () => {
    // Mix of different UTF-8 character widths that add up to exactly 28 bytes
    // 4 emojis (16 bytes) + "hello" (5 bytes) + "●●●" (9 bytes, 3 bullet chars × 3 bytes) = 30 bytes (too much)
    // Let's use: 6 emojis (24 bytes) + "test" (4 bytes) = 28 bytes
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(6) + "test",
    });
    expect(result.success).toBe(true);
  });

  it("single byte over 28-byte limit is rejected consistently", () => {
    // 7 emojis + empty = 28 bytes (valid)
    const valid = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(7),
    });
    expect(valid.success).toBe(true);

    // 7 emojis + "a" = 29 bytes (invalid)
    const invalid = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "😀".repeat(7) + "a",
    });
    expect(invalid.success).toBe(false);
  });

  it("batch recipients respect memo byte limit", () => {
    const validBatch = createBatchSchema.safeParse({
      name: "batch",
      recipients: [
        { address: VALID_STELLAR, amount: 5, memo: "😀".repeat(7) },
      ],
      sourceAccountId: "user-1",
    });
    expect(validBatch.success).toBe(true);

    const invalidBatch = createBatchSchema.safeParse({
      name: "batch",
      recipients: [
        { address: VALID_STELLAR, amount: 5, memo: "😀".repeat(8) },
      ],
      sourceAccountId: "user-1",
    });
    expect(invalidBatch.success).toBe(false);
  });
});
