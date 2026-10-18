// SPDX-License-Identifier: MIT
// Unit tests for batch-validator.ts: row-level validation, aggregate metrics, and constraint checks

import { describe, it, expect } from "vitest";
import {
  validateBatchRecipientRow,
  calculateBatchTotals,
  validateBatchRecipients,
  MEMO_MAX_BYTES,
} from "@/lib/batch-validator";
import type { BatchRecipient } from "@/types";

const VALID_ADDR_1 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_ADDR_2 = "GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGHD7UAKFD75JILZBCA3QW6";
const INVALID_ADDR = "NOT_A_VALID_STELLAR_ADDRESS";

describe("batch-validator unit tests", () => {
  describe("validateBatchRecipientRow", () => {
    it("flags null, undefined or non-object row as malformed", () => {
      const resNull = validateBatchRecipientRow(null, 0);
      expect(resNull.valid).toBe(false);
      expect(resNull.errors[0].message).toMatch(/malformed or empty row data/i);

      const resUndefined = validateBatchRecipientRow(undefined, 0);
      expect(resUndefined.valid).toBe(false);

      const resPrimitive = validateBatchRecipientRow("invalid" as unknown as BatchRecipient, 0);
      expect(resPrimitive.valid).toBe(false);
    });

    it("validates a compliant recipient row", () => {
      const res = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 100, memo: "Salary" },
        0
      );
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.amount).toBe(100);
    });

    it("flags missing or invalid Stellar address", () => {
      const missing = validateBatchRecipientRow({ address: "", amount: 10 }, 0);
      expect(missing.valid).toBe(false);
      expect(missing.errors.some((e) => e.field === "address" && /required/i.test(e.message))).toBe(true);

      const invalid = validateBatchRecipientRow({ address: INVALID_ADDR, amount: 10 }, 0);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.some((e) => e.field === "address" && /invalid stellar address/i.test(e.message))).toBe(true);
    });

    it("flags self-transfer when selfAddress is matched", () => {
      const res = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 50 },
        0,
        { selfAddress: VALID_ADDR_1 }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => /own address/i.test(e.message))).toBe(true);
    });

    it("flags duplicate address when seenAddresses set contains it", () => {
      const seen = new Set<string>();
      seen.add(VALID_ADDR_1);

      const res = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 50 },
        1,
        { seenAddresses: seen }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => /duplicate address/i.test(e.message))).toBe(true);
    });

    it("flags missing, zero, negative or non-numeric amounts", () => {
      const empty = validateBatchRecipientRow({ address: VALID_ADDR_1, amount: undefined }, 0);
      expect(empty.valid).toBe(false);

      const zero = validateBatchRecipientRow({ address: VALID_ADDR_1, amount: 0 }, 0);
      expect(zero.valid).toBe(false);

      const negative = validateBatchRecipientRow({ address: VALID_ADDR_1, amount: -10 }, 0);
      expect(negative.valid).toBe(false);

      const nan = validateBatchRecipientRow({ address: VALID_ADDR_1, amount: NaN }, 0);
      expect(nan.valid).toBe(false);
    });

    it("validates memo constraints (length, bytes, control chars)", () => {
      // Valid memo
      const validMemo = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 10, memo: "Invoice #1024" },
        0
      );
      expect(validMemo.valid).toBe(true);

      // Memo too long in characters (>28)
      const longMemo = "A".repeat(MEMO_MAX_BYTES + 1);
      const resLong = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 10, memo: longMemo },
        0
      );
      expect(resLong.valid).toBe(false);
      expect(resLong.errors.some((e) => e.field === "memo" && /28/i.test(e.message))).toBe(true);

      // Control character in memo
      const ctrlMemo = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 10, memo: "Hello\u0000World" },
        0
      );
      expect(ctrlMemo.valid).toBe(false);
      expect(ctrlMemo.errors.some((e) => /control character/i.test(e.message))).toBe(true);

      // Multi-byte non-ASCII memo exceeding 28 bytes even if fewer chars
      // 10 Chinese characters = 30 bytes
      const multiByteOver = "一二三四五六七八九十";
      const resBytes = validateBatchRecipientRow(
        { address: VALID_ADDR_1, amount: 10, memo: multiByteOver },
        0
      );
      expect(resBytes.valid).toBe(false);
      expect(resBytes.errors.some((e) => /28 bytes/i.test(e.message))).toBe(true);
    });
  });

  describe("calculateBatchTotals", () => {
    it("aggregates amounts, valid counts, and error counts accurately", () => {
      const batch: BatchRecipient[] = [
        { address: VALID_ADDR_1, amount: 100, assetCode: "XLM", memo: "p1" },
        { address: VALID_ADDR_2, amount: 50.5, assetCode: "XLM" },
        { address: INVALID_ADDR, amount: 20, assetCode: "XLM" }, // invalid
        { address: VALID_ADDR_1, amount: 30, assetCode: "XLM" }, // duplicate of VALID_ADDR_1
      ];

      const totals = calculateBatchTotals(batch);
      expect(totals.count).toBe(4);
      expect(totals.validCount).toBe(2);
      expect(totals.errorCount).toBe(2);
      expect(totals.totalAmount).toBe(150.5);
    });
  });

  describe("validateBatchRecipients", () => {
    it("returns error for empty recipient list", () => {
      const res = validateBatchRecipients([]);
      expect(res.valid).toBe(false);
      expect(res.errors[0].message).toMatch(/at least one recipient is required/i);
    });

    it("returns error when recipient list exceeds maximum limit (100)", () => {
      const oversized: BatchRecipient[] = Array.from({ length: 101 }, () => ({
        address: VALID_ADDR_1,
        amount: 1,
        assetCode: "XLM",
      }));

      const res = validateBatchRecipients(oversized);
      expect(res.valid).toBe(false);
      expect(res.errors[0].message).toMatch(/maximum 100 recipients/i);
    });

    it("detects when totalAmount exceeds available balance", () => {
      const batch: BatchRecipient[] = [
        { address: VALID_ADDR_1, amount: 100, assetCode: "XLM" },
        { address: VALID_ADDR_2, amount: 50, assetCode: "XLM" },
      ];

      const res = validateBatchRecipients(batch, 120);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => /exceeds available balance/i.test(e.message))).toBe(true);
    });

    it("passes validation when balance is sufficient and all rows are valid", () => {
      const batch: BatchRecipient[] = [
        { address: VALID_ADDR_1, amount: 100, assetCode: "XLM" },
        { address: VALID_ADDR_2, amount: 50, assetCode: "XLM" },
      ];

      const res = validateBatchRecipients(batch, 200);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.totalAmount).toBe(150);
    });
  });
});
