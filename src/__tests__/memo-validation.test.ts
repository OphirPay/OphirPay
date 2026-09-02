// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createPaymentSchema,
  updatePaymentSchema,
  createBatchSchema,
  proposeMultisigPaymentSchema,
  MEMO_ERROR_MESSAGES,
} from "@/lib/validation-schemas";
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
  ])("rejects %s control characters in a memo", (_name, memo) => {
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
