// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  STELLAR_MEMO_TYPES,
  STELLAR_MEMO_ERRORS,
  STELLAR_MEMO_MAX_BYTES,
  getMemoByteLength,
  validateMemoByteLength,
  validateStellarMemoValue,
  stellarMemoTextSchema,
  stellarMemoIdSchema,
  stellarMemoHashSchema,
  stellarMemoReturnSchema,
  stellarMemoInputSchema,
} from "@/lib/validation/stellar";
import {
  createPaymentSchema,
  createPaymentRequestSchema,
} from "@/lib/validation-schemas";

const VALID_STELLAR = "G" + "A".repeat(55);

describe("Stellar Memo Validation (stellar.ts)", () => {
  describe("UTF-8 Multibyte Byte Counting", () => {
    it("correctly counts ASCII characters as 1 byte each", () => {
      expect(getMemoByteLength("hello")).toBe(5);
      expect(getMemoByteLength("a".repeat(28))).toBe(28);
    });

    it("correctly counts Vietnamese accented characters as multibyte UTF-8", () => {
      // 'ế' is 2 bytes in UTF-8
      const text = "Cà phê"; // C(1) + à(2) + ' '(1) + p(1) + h(1) + ê(2) = 8 bytes
      expect(getMemoByteLength(text)).toBe(8);
      expect(validateMemoByteLength(text)).toBe(true);
    });

    it("correctly counts emojis (4 bytes each in UTF-8)", () => {
      const emoji7 = "🚀".repeat(7); // 7 * 4 = 28 bytes
      expect(getMemoByteLength(emoji7)).toBe(28);
      expect(validateMemoByteLength(emoji7)).toBe(true);

      const emoji8 = "🚀".repeat(8); // 8 * 4 = 32 bytes
      expect(getMemoByteLength(emoji8)).toBe(32);
      expect(validateMemoByteLength(emoji8)).toBe(false);
    });

    it("fails when multibyte string exceeds 28 bytes even if character length <= 28", () => {
      const accented = "Tiếng Việt có dấu rất đẹp"; // length is 25 chars, but UTF-8 byte length is 32 bytes
      expect(accented.length).toBeLessThanOrEqual(STELLAR_MEMO_MAX_BYTES);
      expect(getMemoByteLength(accented)).toBeGreaterThan(STELLAR_MEMO_MAX_BYTES);
      expect(validateMemoByteLength(accented)).toBe(false);
    });
  });

  describe("Variant 1: MEMO_TEXT", () => {
    it("accepts valid ASCII and multibyte text <= 28 bytes", () => {
      expect(validateStellarMemoValue("Invoice-1234", "MEMO_TEXT")).toEqual({ valid: true });
      expect(validateStellarMemoValue("🚀".repeat(7), "MEMO_TEXT")).toEqual({ valid: true });
      expect(validateStellarMemoValue("Xin chào", "MEMO_TEXT")).toEqual({ valid: true });
    });

    it("rejects text exceeding 28 characters", () => {
      const res = validateStellarMemoValue("a".repeat(29), "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.tooLong);
    });

    it("rejects text <= 28 chars but > 28 bytes with descriptive message", () => {
      const res = validateStellarMemoValue("😀".repeat(8), "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.tooManyBytes);
    });

    it("rejects control characters in MEMO_TEXT", () => {
      const res = validateStellarMemoValue("line1\nline2", "MEMO_TEXT");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.controlChars);
    });
  });

  describe("Variant 2: MEMO_ID", () => {
    it("accepts valid 64-bit unsigned integers", () => {
      expect(validateStellarMemoValue("0", "MEMO_ID")).toEqual({ valid: true });
      expect(validateStellarMemoValue("123456789", "MEMO_ID")).toEqual({ valid: true });
      expect(validateStellarMemoValue("18446744073709551615", "MEMO_ID")).toEqual({ valid: true }); // uint64 max
    });

    it("rejects negative numbers", () => {
      const res = validateStellarMemoValue("-1", "MEMO_ID");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidId);
    });

    it("rejects non-numeric strings", () => {
      const res = validateStellarMemoValue("123abc", "MEMO_ID");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidId);
    });

    it("rejects numbers exceeding 64-bit unsigned integer maximum", () => {
      const res = validateStellarMemoValue("18446744073709551616", "MEMO_ID"); // 2^64
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidId);
    });
  });

  describe("Variant 3: MEMO_HASH", () => {
    it("accepts a valid 64-character hex string (32 bytes)", () => {
      const validHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(validateStellarMemoValue(validHash, "MEMO_HASH")).toEqual({ valid: true });
    });

    it("rejects hash with invalid length (< 64 chars)", () => {
      const shortHash = "0123456789abcdef";
      const res = validateStellarMemoValue(shortHash, "MEMO_HASH");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidHash);
    });

    it("rejects hash with non-hex characters", () => {
      const nonHex = "g".repeat(64);
      const res = validateStellarMemoValue(nonHex, "MEMO_HASH");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidHash);
    });
  });

  describe("Variant 4: MEMO_RETURN", () => {
    it("accepts a valid 64-character hex string (32 bytes)", () => {
      const validReturn = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      expect(validateStellarMemoValue(validReturn, "MEMO_RETURN")).toEqual({ valid: true });
    });

    it("rejects return hash with invalid length", () => {
      const shortReturn = "abcdef";
      const res = validateStellarMemoValue(shortReturn, "MEMO_RETURN");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidReturn);
    });

    it("rejects return hash with non-hex characters", () => {
      const nonHex = "z".repeat(64);
      const res = validateStellarMemoValue(nonHex, "MEMO_RETURN");
      expect(res.valid).toBe(false);
      expect(res.error).toBe(STELLAR_MEMO_ERRORS.invalidReturn);
    });
  });

  describe("Route Integration Schemas (createPaymentSchema & createPaymentRequestSchema)", () => {
    const paymentBase = {
      amount: 50,
      sourceAccountId: "source-123",
      destAddress: VALID_STELLAR,
    };

    it("createPaymentSchema accepts all 4 valid variants with explicit memoType", () => {
      // MEMO_TEXT
      expect(
        createPaymentSchema.safeParse({
          ...paymentBase,
          memo: "Payment for order 123",
          memoType: "MEMO_TEXT",
        }).success
      ).toBe(true);

      // MEMO_ID
      expect(
        createPaymentSchema.safeParse({
          ...paymentBase,
          memo: "9876543210",
          memoType: "MEMO_ID",
        }).success
      ).toBe(true);

      // MEMO_HASH
      expect(
        createPaymentSchema.safeParse({
          ...paymentBase,
          memo: "a".repeat(64),
          memoType: "MEMO_HASH",
        }).success
      ).toBe(true);

      // MEMO_RETURN
      expect(
        createPaymentSchema.safeParse({
          ...paymentBase,
          memo: "f".repeat(64),
          memoType: "MEMO_RETURN",
        }).success
      ).toBe(true);
    });

    it("createPaymentSchema rejects invalid memoType variant with descriptive error", () => {
      const idResult = createPaymentSchema.safeParse({
        ...paymentBase,
        memo: "not-a-number",
        memoType: "MEMO_ID",
      });
      expect(idResult.success).toBe(false);
      if (!idResult.success) {
        expect(idResult.error.issues[0].message).toBe(STELLAR_MEMO_ERRORS.invalidId);
      }

      const hashResult = createPaymentSchema.safeParse({
        ...paymentBase,
        memo: "too-short",
        memoType: "MEMO_HASH",
      });
      expect(hashResult.success).toBe(false);
      if (!hashResult.success) {
        expect(hashResult.error.issues[0].message).toBe(STELLAR_MEMO_ERRORS.invalidHash);
      }
    });

    it("createPaymentRequestSchema validates memo and memoType", () => {
      const requestBase = {
        amount: 25,
      };

      const valid = createPaymentRequestSchema.safeParse({
        ...requestBase,
        memo: "Invoice request",
        memoType: "MEMO_TEXT",
      });
      expect(valid.success).toBe(true);

      const invalid = createPaymentRequestSchema.safeParse({
        ...requestBase,
        memo: "😀".repeat(8),
        memoType: "MEMO_TEXT",
      });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0].message).toBe(STELLAR_MEMO_ERRORS.tooManyBytes);
      }
    });
  });
});
