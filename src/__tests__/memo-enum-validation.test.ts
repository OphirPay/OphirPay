// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  memoTypeEnum,
  normalizedMemoTypeSchema,
  isValidMemoType,
  validMemoTypes,
} from "@/lib/validation/memo";
import { createPaymentSchema, createBatchSchema } from "@/lib/validation-schemas";

const VALID_STELLAR = "GDV4VOJNQL7UAPHPOH7BLFOG3CJZ2A65FCHTYWPHZVMQ3OQG5W757FCE";
const VALID_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Stellar memo type enum validation (Issue #1948)", () => {
  it("defines the 4 canonical lowercase memo types", () => {
    expect(validMemoTypes).toEqual(["text", "id", "hash", "return"]);
  });

  describe("memoTypeEnum", () => {
    it.each(["text", "id", "hash", "return"] as const)(
      "accepts valid memo type '%s'",
      (type) => {
        const result = memoTypeEnum.safeParse(type);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(type);
        }
      }
    );

    it.each(["binary", "MEMO_TEXT", "unknown", "none", "123", ""])(
      "rejects invalid memo type string '%s' with a clear error message",
      (invalidType) => {
        const result = memoTypeEnum.safeParse(invalidType);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toMatch(/memoType must be one of/i);
        }
      }
    );
  });

  describe("normalizedMemoTypeSchema", () => {
    it("normalizes uppercase Horizon names to lowercase forms", () => {
      expect(normalizedMemoTypeSchema.parse("MEMO_TEXT")).toBe("text");
      expect(normalizedMemoTypeSchema.parse("MEMO_ID")).toBe("id");
      expect(normalizedMemoTypeSchema.parse("MEMO_HASH")).toBe("hash");
      expect(normalizedMemoTypeSchema.parse("MEMO_RETURN")).toBe("return");
    });

    it("accepts existing lowercase forms unchanged", () => {
      expect(normalizedMemoTypeSchema.parse("text")).toBe("text");
      expect(normalizedMemoTypeSchema.parse("id")).toBe("id");
      expect(normalizedMemoTypeSchema.parse("hash")).toBe("hash");
      expect(normalizedMemoTypeSchema.parse("return")).toBe("return");
    });

    it("rejects unknown memo types", () => {
      expect(normalizedMemoTypeSchema.safeParse("MEMO_INVALID").success).toBe(false);
      expect(normalizedMemoTypeSchema.safeParse("invalid").success).toBe(false);
    });
  });

  describe("isValidMemoType helper", () => {
    it("returns true for valid types", () => {
      expect(isValidMemoType("text")).toBe(true);
      expect(isValidMemoType("ID")).toBe(true);
      expect(isValidMemoType(" hash ")).toBe(true);
      expect(isValidMemoType("return")).toBe(true);
    });

    it("returns false for invalid types", () => {
      expect(isValidMemoType("invalid")).toBe(false);
      expect(isValidMemoType(null)).toBe(false);
      expect(isValidMemoType(undefined)).toBe(false);
      expect(isValidMemoType(123)).toBe(false);
    });
  });

  describe("Integration with payment and batch mutation schemas", () => {
    const paymentBase = {
      amount: 10,
      sourceAccountId: "src-1",
      destAddress: VALID_STELLAR,
      assetCode: "XLM",
    };

    it("accepts payment requests with valid memo and valid memoType", () => {
      const res = createPaymentSchema.safeParse({
        ...paymentBase,
        memo: "order-42",
        memoType: "text",
      });
      expect(res.success).toBe(true);
    });

    it("rejects payment requests with invalid memoType", () => {
      const res = createPaymentSchema.safeParse({
        ...paymentBase,
        memo: "order-42",
        memoType: "invalid_type",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain("memoType must be one of");
      }
    });

    it("accepts batch requests with valid recipient memoTypes", () => {
      const res = createBatchSchema.safeParse({
        name: "Test Batch",
        sourceAccountId: "source-account",
        recipients: [
          {
            address: VALID_STELLAR,
            amount: 5,
            memo: "test",
            memoType: "text",
          },
          {
            address: VALID_STELLAR,
            amount: 10,
            memo: VALID_HASH,
            memoType: "hash",
          },
        ],
      });
      expect(res.success).toBe(true);
    });

    it("rejects batch requests with invalid recipient memoType", () => {
      const res = createBatchSchema.safeParse({
        name: "Test Batch",
        sourceAccountId: "source-account",
        recipients: [
          {
            address: VALID_STELLAR,
            amount: 5,
            memo: "test",
            memoType: "unsupported",
          },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain("memoType must be one of");
      }
    });
  });
});
