// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  validateStellarMemo,
  normalizeMemoType,
  MEMO_ERROR_MESSAGES,
} from "@/lib/validation/stellar";
import {
  createPaymentSchema,
  updatePaymentSchema,
  batchRecipientSchema,
  proposeMultisigPaymentSchema,
  createPaymentRequestSchema,
  memoField,
} from "@/lib/validation-schemas";

const VALID_STELLAR_ADDR = "G" + "A".repeat(55);
const VALID_HASH_64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_RETURN_64 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const validPaymentBase = {
  amount: 25.5,
  sourceAccountId: "source-account-1",
  destAddress: VALID_STELLAR_ADDR,
  assetCode: "XLM",
};

describe("Stellar Memo 5D Matrix Exhaustive Test Suite", () => {
  // ── Dimension 1: Full Range Boundaries & Clamping ─────────────
  describe("Dimension 1: Full Range Boundaries & Clamping", () => {
    describe("Text byte length bounds (0 to 28 bytes)", () => {
      it("accepts empty string as valid text memo", () => {
        const res = validateStellarMemo("", "MEMO_TEXT");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(0);
      });

      it("accepts single ASCII byte (1 byte)", () => {
        const res = validateStellarMemo("x", "MEMO_TEXT");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(1);
      });

      it("accepts exactly 27 ASCII bytes", () => {
        const str = "a".repeat(27);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(27);
      });

      it("accepts boundary maximum exactly 28 ASCII bytes", () => {
        const str = "a".repeat(28);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(28);
      });

      it("rejects boundary +1 (29 ASCII bytes) with tooLong error", () => {
        const str = "a".repeat(29);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.tooLong);
      });

      it("rejects extreme overflow (1000 ASCII bytes)", () => {
        const str = "a".repeat(1000);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.tooLong);
      });

      it("accepts 14 2-byte characters (exactly 28 bytes)", () => {
        // 'ж' is 2 bytes in UTF-8
        const str = "ж".repeat(14);
        expect(Buffer.byteLength(str, "utf8")).toBe(28);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("rejects 15 2-byte characters (30 bytes, 15 chars) with tooManyBytes", () => {
        const str = "ж".repeat(15);
        expect(str.length).toBe(15);
        expect(Buffer.byteLength(str, "utf8")).toBe(30);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
      });

      it("accepts 9 3-byte characters (27 bytes)", () => {
        // '€' is 3 bytes in UTF-8
        const str = "€".repeat(9);
        expect(Buffer.byteLength(str, "utf8")).toBe(27);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("rejects 10 3-byte characters (30 bytes, 10 chars) with tooManyBytes", () => {
        const str = "€".repeat(10);
        expect(str.length).toBe(10);
        expect(Buffer.byteLength(str, "utf8")).toBe(30);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
      });

      it("accepts exactly 7 4-byte emojis (28 bytes)", () => {
        // '🚀' is 4 bytes in UTF-8
        const str = "🚀".repeat(7);
        expect(Buffer.byteLength(str, "utf8")).toBe(28);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("rejects 8 4-byte emojis (32 bytes, 16 UTF-16 units) with tooManyBytes", () => {
        const str = "🚀".repeat(8);
        expect(str.length).toBe(16);
        expect(Buffer.byteLength(str, "utf8")).toBe(32);
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.tooManyBytes);
      });
    });

    describe("Memo ID boundaries (u64 range: 0 to 18446744073709551615)", () => {
      it("accepts minimum boundary 0", () => {
        const res = validateStellarMemo("0", "MEMO_ID");
        expect(res.valid).toBe(true);
      });

      it("accepts small integer 1", () => {
        const res = validateStellarMemo("1", "MEMO_ID");
        expect(res.valid).toBe(true);
      });

      it("accepts intermediate safe integer 9007199254740991", () => {
        const res = validateStellarMemo("9007199254740991", "MEMO_ID");
        expect(res.valid).toBe(true);
      });

      it("accepts beyond safe JS integer up to u64 max - 1", () => {
        const res = validateStellarMemo("18446744073709551614", "MEMO_ID");
        expect(res.valid).toBe(true);
      });

      it("accepts exact u64 maximum boundary 18446744073709551615 (2^64 - 1)", () => {
        const res = validateStellarMemo("18446744073709551615", "MEMO_ID");
        expect(res.valid).toBe(true);
      });

      it("rejects u64 boundary + 1 (18446744073709551616) with idOverflow", () => {
        const res = validateStellarMemo("18446744073709551616", "MEMO_ID");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.idOverflow);
      });

      it("rejects massive integer overflow (10^30) with idOverflow", () => {
        const res = validateStellarMemo("999999999999999999999999999999", "MEMO_ID");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.idOverflow);
      });
    });

    describe("Memo Hash & Return length boundaries (exactly 64 hex characters)", () => {
      it("rejects 0 characters for MEMO_HASH", () => {
        const res = validateStellarMemo("", "MEMO_HASH");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidHash);
      });

      it("rejects 63 characters for MEMO_HASH", () => {
        const res = validateStellarMemo("a".repeat(63), "MEMO_HASH");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidHash);
      });

      it("accepts exactly 64 characters for MEMO_HASH", () => {
        const res = validateStellarMemo("a".repeat(64), "MEMO_HASH");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(32);
      });

      it("rejects 65 characters for MEMO_HASH", () => {
        const res = validateStellarMemo("a".repeat(65), "MEMO_HASH");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidHash);
      });

      it("rejects 0 characters for MEMO_RETURN", () => {
        const res = validateStellarMemo("", "MEMO_RETURN");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidReturn);
      });

      it("rejects 63 characters for MEMO_RETURN", () => {
        const res = validateStellarMemo("f".repeat(63), "MEMO_RETURN");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidReturn);
      });

      it("accepts exactly 64 characters for MEMO_RETURN", () => {
        const res = validateStellarMemo("f".repeat(64), "MEMO_RETURN");
        expect(res.valid).toBe(true);
        expect(res.byteLength).toBe(32);
      });

      it("rejects 65 characters for MEMO_RETURN", () => {
        const res = validateStellarMemo("f".repeat(65), "MEMO_RETURN");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidReturn);
      });
    });
  });

  // ── Dimension 2: Combinatorics across Memo Types & Schema Endpoints ──
  describe("Dimension 2: Combinatorics across Memo Types & Endpoints", () => {
    describe("Type normalization variations", () => {
      it.each([
        ["MEMO_TEXT", "MEMO_TEXT"],
        ["text", "MEMO_TEXT"],
        ["Text", "MEMO_TEXT"],
        ["TEXT", "MEMO_TEXT"],
        [undefined, "MEMO_TEXT"],
        [null, "MEMO_TEXT"],
        ["unknown", "MEMO_TEXT"],
      ])("normalizes %s to %s", (input, expected) => {
        expect(normalizeMemoType(input as string)).toBe(expected);
      });

      it.each([
        ["MEMO_ID", "MEMO_ID"],
        ["id", "MEMO_ID"],
        ["Id", "MEMO_ID"],
        ["ID", "MEMO_ID"],
      ])("normalizes ID variant %s to %s", (input, expected) => {
        expect(normalizeMemoType(input)).toBe(expected);
      });

      it.each([
        ["MEMO_HASH", "MEMO_HASH"],
        ["hash", "MEMO_HASH"],
        ["Hash", "MEMO_HASH"],
        ["HASH", "MEMO_HASH"],
      ])("normalizes HASH variant %s to %s", (input, expected) => {
        expect(normalizeMemoType(input)).toBe(expected);
      });

      it.each([
        ["MEMO_RETURN", "MEMO_RETURN"],
        ["return", "MEMO_RETURN"],
        ["Return", "MEMO_RETURN"],
        ["RETURN", "MEMO_RETURN"],
      ])("normalizes RETURN variant %s to %s", (input, expected) => {
        expect(normalizeMemoType(input)).toBe(expected);
      });
    });

    describe("createPaymentSchema combinations", () => {
      it("accepts valid MEMO_TEXT with string memo and no explicit memoType", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "order-991",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("order-991");
      });

      it("accepts valid MEMO_TEXT with explicit memoType: 'MEMO_TEXT'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "order-991",
          memoType: "MEMO_TEXT",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("order-991");
      });

      it("accepts valid MEMO_ID with string memo and memoType: 'MEMO_ID'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "987654321",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("987654321");
      });

      it("accepts valid MEMO_ID with lowercase memoType: 'id'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "12345",
          memoType: "id",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("12345");
      });

      it("rejects invalid MEMO_ID in createPaymentSchema", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "not-a-number",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe(MEMO_ERROR_MESSAGES.invalidId);
        }
      });

      it("accepts 64-char hex with memoType: 'MEMO_HASH'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: VALID_HASH_64,
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe(VALID_HASH_64);
      });

      it("rejects 64-char non-hex with memoType: 'MEMO_HASH'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "z".repeat(64),
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe(MEMO_ERROR_MESSAGES.invalidHash);
        }
      });

      it("accepts 64-char hex with memoType: 'MEMO_RETURN'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: VALID_RETURN_64,
          memoType: "MEMO_RETURN",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe(VALID_RETURN_64);
      });

      it("rejects short string with memoType: 'MEMO_RETURN'", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "deadbeef",
          memoType: "MEMO_RETURN",
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe(MEMO_ERROR_MESSAGES.invalidReturn);
        }
      });

      it("accepts structured memo object { value, type: 'MEMO_ID' }", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: { value: "456789", type: "MEMO_ID" },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("456789");
      });

      it("accepts structured memo object { value, type: 'MEMO_HASH' }", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: { value: VALID_HASH_64, type: "MEMO_HASH" },
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe(VALID_HASH_64);
      });
    });

    describe("updatePaymentSchema combinations", () => {
      it("accepts memo update with memoType: 'MEMO_ID'", () => {
        const parsed = updatePaymentSchema.safeParse({
          memo: "998877",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("998877");
      });

      it("rejects invalid memo update with memoType: 'MEMO_ID'", () => {
        const parsed = updatePaymentSchema.safeParse({
          memo: "invalid-id",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues[0].message).toBe(MEMO_ERROR_MESSAGES.invalidId);
        }
      });

      it("accepts memo update with memoType: 'MEMO_HASH'", () => {
        const parsed = updatePaymentSchema.safeParse({
          memo: VALID_HASH_64,
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(true);
      });

      it("rejects memo update with memoType: 'MEMO_HASH' when invalid length", () => {
        const parsed = updatePaymentSchema.safeParse({
          memo: "1234",
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(false);
      });
    });

    describe("batchRecipientSchema and proposeMultisigPaymentSchema combinations", () => {
      it("batchRecipientSchema accepts memo with memoType: 'MEMO_ID'", () => {
        const parsed = batchRecipientSchema.safeParse({
          address: VALID_STELLAR_ADDR,
          amount: 10,
          memo: "112233",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("112233");
      });

      it("batchRecipientSchema rejects invalid memo ID", () => {
        const parsed = batchRecipientSchema.safeParse({
          address: VALID_STELLAR_ADDR,
          amount: 10,
          memo: "-50",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(false);
      });

      it("proposeMultisigPaymentSchema accepts memo with memoType: 'MEMO_HASH'", () => {
        const parsed = proposeMultisigPaymentSchema.safeParse({
          payee: VALID_STELLAR_ADDR,
          amount: 50,
          memo: VALID_HASH_64,
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe(VALID_HASH_64);
      });

      it("proposeMultisigPaymentSchema rejects control characters in text memo", () => {
        const parsed = proposeMultisigPaymentSchema.safeParse({
          payee: VALID_STELLAR_ADDR,
          amount: 50,
          memo: "hello\x00world",
        });
        expect(parsed.success).toBe(false);
      });
    });

    describe("createPaymentRequestSchema combinations", () => {
      it("accepts valid memo with memoType in payment request", () => {
        const parsed = createPaymentRequestSchema.safeParse({
          amount: 100,
          memo: "request-memo-1",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("request-memo-1");
      });

      it("accepts valid typed memo in payment request", () => {
        const parsed = createPaymentRequestSchema.safeParse({
          amount: 100,
          memo: "12345678",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("12345678");
      });

      it("rejects invalid memo in payment request", () => {
        const parsed = createPaymentRequestSchema.safeParse({
          amount: 100,
          memo: "a".repeat(29),
        });
        expect(parsed.success).toBe(false);
      });
    });

    describe("memoField standalone combinations", () => {
      it("accepts string memo under 28 bytes", () => {
        const parsed = memoField.safeParse("quick-memo");
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data).toBe("quick-memo");
      });

      it("accepts typed memo object { value: '123', type: 'MEMO_ID' }", () => {
        const parsed = memoField.safeParse({ value: "123", type: "MEMO_ID" });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data).toBe("123");
      });

      it("rejects typed memo object with invalid ID", () => {
        const parsed = memoField.safeParse({ value: "abc", type: "MEMO_ID" });
        expect(parsed.success).toBe(false);
      });

      it("accepts typed memo object { value: 64-hex, type: 'MEMO_HASH' }", () => {
        const parsed = memoField.safeParse({ value: VALID_HASH_64, type: "MEMO_HASH" });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data).toBe(VALID_HASH_64);
      });
    });
  });

  // ── Dimension 3: Host Variations & Payload Encodings ─────────
  describe("Dimension 3: Host Variations & Payload Encodings", () => {
    describe("Multilingual UTF-8 encodings", () => {
      it("accepts Cyrillic UTF-8 text within 28 bytes", () => {
        const text = "Оплата счета"; // 23 bytes
        expect(Buffer.byteLength(text, "utf8")).toBe(23);
        const res = validateStellarMemo(text, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("accepts Japanese Kanji UTF-8 text within 28 bytes", () => {
        const text = "支払完了確認"; // 6 chars * 3 = 18 bytes
        expect(Buffer.byteLength(text, "utf8")).toBe(18);
        const res = validateStellarMemo(text, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("accepts Arabic UTF-8 text within 28 bytes", () => {
        const text = "دفعة شهرية"; // 19 bytes
        expect(Buffer.byteLength(text, "utf8")).toBe(19);
        const res = validateStellarMemo(text, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("accepts Greek UTF-8 text within 28 bytes", () => {
        const text = "Πληρωμή"; // 14 bytes
        expect(Buffer.byteLength(text, "utf8")).toBe(14);
        const res = validateStellarMemo(text, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });

      it("accepts Devanagari UTF-8 text within 28 bytes", () => {
        const text = "भुगतान"; // 18 bytes
        expect(Buffer.byteLength(text, "utf8")).toBe(18);
        const res = validateStellarMemo(text, "MEMO_TEXT");
        expect(res.valid).toBe(true);
      });
    });

    describe("Hex case variations for Hash and Return", () => {
      it("accepts lowercase hex characters for MEMO_HASH", () => {
        const hex = "abcdef0123456789".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_HASH");
        expect(res.valid).toBe(true);
      });

      it("accepts UPPERCASE hex characters for MEMO_HASH", () => {
        const hex = "ABCDEF0123456789".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_HASH");
        expect(res.valid).toBe(true);
      });

      it("accepts mixed case hex characters for MEMO_HASH", () => {
        const hex = "AbCdEf0123456789".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_HASH");
        expect(res.valid).toBe(true);
      });

      it("accepts lowercase hex characters for MEMO_RETURN", () => {
        const hex = "1234567890abcdef".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_RETURN");
        expect(res.valid).toBe(true);
      });

      it("accepts UPPERCASE hex characters for MEMO_RETURN", () => {
        const hex = "1234567890ABCDEF".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_RETURN");
        expect(res.valid).toBe(true);
      });

      it("accepts mixed case hex characters for MEMO_RETURN", () => {
        const hex = "1234567890aBcDeF".repeat(4);
        const res = validateStellarMemo(hex, "MEMO_RETURN");
        expect(res.valid).toBe(true);
      });
    });

    describe("Whitespace and empty payload variations", () => {
      it("trims surrounding whitespace for MEMO_TEXT", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "   invoice-123   ",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("invoice-123");
      });

      it("trims surrounding whitespace for MEMO_ID", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "   778899   ",
          memoType: "MEMO_ID",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("778899");
      });

      it("trims surrounding whitespace for MEMO_HASH", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: `   ${VALID_HASH_64}   `,
          memoType: "MEMO_HASH",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe(VALID_HASH_64);
      });

      it("treats whitespace-only text memo as empty (valid, trimmed to empty)", () => {
        const parsed = createPaymentSchema.safeParse({
          ...validPaymentBase,
          memo: "     ",
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBe("");
      });

      it("allows undefined memo (optional field)", () => {
        const parsed = createPaymentSchema.safeParse(validPaymentBase);
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.memo).toBeUndefined();
      });
    });
  });

  // ── Dimension 4: Negative Controls & Security Invariants ─────
  describe("Dimension 4: Negative Controls & Security Invariants", () => {
    describe("Control & invisible character rejections", () => {
      it.each([
        ["NUL (\\u0000)", "memo\u0000text"],
        ["SOH (\\u0001)", "memo\u0001text"],
        ["STX (\\u0002)", "memo\u0002text"],
        ["ETX (\\u0003)", "memo\u0003text"],
        ["EOT (\\u0004)", "memo\u0004text"],
        ["ENQ (\\u0005)", "memo\u0005text"],
        ["ACK (\\u0006)", "memo\u0006text"],
        ["BEL (\\u0007)", "memo\u0007text"],
        ["Backspace (\\u0008)", "memo\u0008text"],
        ["Tab (\\t)", "memo\ttext"],
        ["Newline (\\n)", "memo\ntext"],
        ["Vertical Tab (\\v)", "memo\vtext"],
        ["Form Feed (\\f)", "memo\ftext"],
        ["Carriage Return (\\r)", "memo\rtext"],
        ["Escape (\\u001b)", "memo\u001btext"],
        ["Delete (\\u007f)", "memo\u007ftext"],
        ["C1 Control (\\u0085)", "memo\u0085text"],
        ["C1 Control (\\u009f)", "memo\u009ftext"],
        ["Zero-Width Space (\\u200b)", "memo\u200btext"],
        ["Zero-Width Non-Joiner (\\u200c)", "memo\u200ctext"],
        ["Zero-Width Joiner (\\u200d)", "memo\u200dtext"],
        ["Left-to-Right Mark (\\u200e)", "memo\u200etext"],
        ["Right-to-Left Mark (\\u200f)", "memo\u200ftext"],
        ["Left-to-Right Embedding (\\u202a)", "memo\u202atext"],
        ["Right-to-Left Embedding (\\u202b)", "memo\u202btext"],
        ["Pop Directional Formatting (\\u202c)", "memo\u202ctext"],
        ["Left-to-Right Override (\\u202d)", "memo\u202dtext"],
        ["Right-to-Left Override (\\u202e)", "memo\u202etext"],
        ["Left-to-Right Isolate (\\u2066)", "memo\u2066text"],
        ["Right-to-Left Isolate (\\u2067)", "memo\u2067text"],
        ["First Strong Isolate (\\u2068)", "memo\u2068text"],
        ["Pop Directional Isolate (\\u2069)", "memo\u2069text"],
      ])("rejects text memo containing %s", (_name, memo) => {
        const res = validateStellarMemo(memo, "MEMO_TEXT");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.controlChars);
      });
    });

    describe("Malformed ID rejections", () => {
      it.each([
        ["negative number", "-1"],
        ["negative large", "-18446744073709551615"],
        ["decimal fraction", "123.45"],
        ["hex prefix", "0x123"],
        ["scientific notation", "1e10"],
        ["letters", "123a45"],
        ["punctuation", "12,345"],
        ["embedded space", "123 456"],
        ["empty string", ""],
      ])("rejects invalid MEMO_ID format: %s", (_name, value) => {
        const res = validateStellarMemo(value, "MEMO_ID");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidId);
      });
    });

    describe("Malformed Hash & Return rejections", () => {
      it.each([
        ["non-hex letter 'g'", "g".repeat(64)],
        ["non-hex letter 'z'", "z".repeat(64)],
        ["embedded spaces", "a".repeat(32) + " " + "a".repeat(31)],
        ["embedded dash", "a".repeat(32) + "-" + "a".repeat(31)],
        ["too short (32 chars)", "a".repeat(32)],
        ["empty string", ""],
      ])("rejects invalid MEMO_HASH: %s", (_name, value) => {
        const res = validateStellarMemo(value, "MEMO_HASH");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidHash);
      });

      it.each([
        ["non-hex letter 'g'", "g".repeat(64)],
        ["non-hex letter 'x'", "x".repeat(64)],
        ["embedded symbol", "b".repeat(32) + "@" + "b".repeat(31)],
        ["too long (66 chars)", "b".repeat(66)],
        ["empty string", ""],
      ])("rejects invalid MEMO_RETURN: %s", (_name, value) => {
        const res = validateStellarMemo(value, "MEMO_RETURN");
        expect(res.valid).toBe(false);
        expect(res.error).toBe(MEMO_ERROR_MESSAGES.invalidReturn);
      });
    });

    describe("State isolation & negative side-effect checks", () => {
      it("does not mutate original payload on parse failure", () => {
        const payload = {
          ...validPaymentBase,
          memo: "a".repeat(30),
        };
        const snapshot = JSON.stringify(payload);
        const parsed = createPaymentSchema.safeParse(payload);
        expect(parsed.success).toBe(false);
        expect(JSON.stringify(payload)).toBe(snapshot);
      });

      it("does not mutate original payload on parse success", () => {
        const payload = {
          ...validPaymentBase,
          memo: "  clean-memo  ",
        };
        const snapshot = JSON.stringify(payload);
        const parsed = createPaymentSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
        expect(JSON.stringify(payload)).toBe(snapshot);
        if (parsed.success) {
          expect(parsed.data.memo).toBe("clean-memo");
        }
      });
    });
  });

  // ── Dimension 5: Lifecycle, High-Throughput & Stress ──────────
  describe("Dimension 5: Lifecycle, High-Throughput & Stress", () => {
    it("handles 150 consecutive validations with random mixed inputs without degradation", () => {
      const start = Date.now();
      for (let i = 0; i < 150; i++) {
        const variant = i % 4;
        if (variant === 0) {
          const res = validateStellarMemo(`memo-${i}`, "MEMO_TEXT");
          expect(res.valid).toBe(true);
        } else if (variant === 1) {
          const res = validateStellarMemo(`${i * 1000}`, "MEMO_ID");
          expect(res.valid).toBe(true);
        } else if (variant === 2) {
          const res = validateStellarMemo(VALID_HASH_64, "MEMO_HASH");
          expect(res.valid).toBe(true);
        } else {
          const res = validateStellarMemo(VALID_RETURN_64, "MEMO_RETURN");
          expect(res.valid).toBe(true);
        }
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // 150 validations complete in well under 1 second
    });

    it("idempotently produces the same result on repeated schema evaluations", () => {
      const payload = {
        ...validPaymentBase,
        memo: "idempotent-test",
        memoType: "MEMO_TEXT" as const,
      };
      const res1 = createPaymentSchema.safeParse(payload);
      const res2 = createPaymentSchema.safeParse(payload);
      const res3 = createPaymentSchema.safeParse(payload);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res3.success).toBe(true);

      if (res1.success && res2.success && res3.success) {
        expect(res1.data.memo).toBe(res2.data.memo);
        expect(res2.data.memo).toBe(res3.data.memo);
      }
    });

    it("consistently rejects invalid memos across multiple invocations without state leakage", () => {
      const badPayload = {
        ...validPaymentBase,
        memo: "bad\x00memo",
      };
      for (let i = 0; i < 20; i++) {
        const res = createPaymentSchema.safeParse(badPayload);
        expect(res.success).toBe(false);
      }
    });

    it("verifies byteLength computation accuracy across diverse multi-byte character ranges", () => {
      const samples: Array<[string, number]> = [
        ["a", 1],
        ["©", 2],
        ["€", 3],
        ["𐍈", 4],
        ["hello 🌍", 10], // 6 ASCII + space + 4-byte emoji = 11 bytes? Let's check: "hello " is 6, emoji is 4 = 10 bytes!
      ];
      for (const [str, expectedBytes] of samples) {
        const res = validateStellarMemo(str, "MEMO_TEXT");
        expect(res.byteLength).toBe(expectedBytes);
      }
    });
  });
});
