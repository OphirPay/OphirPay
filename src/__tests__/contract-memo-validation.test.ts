// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { decodeContractError, getContractErrorCatalog } from "@/lib/contract-errors";
import { PAYMENT_ERROR_NAMES, PAYMENT_ERROR_DISCRIMINANTS, ERROR_MESSAGES } from "@/types/errors";
import { PaymentErrorCode, PAYMENT_ERROR_MESSAGES } from "@/types/contract-abi";

// Mirror of contract validate_memo_text logic for parity verification
function validateMemoText(memo: string): { valid: boolean; error?: string } {
  const bytes = Buffer.from(memo, "utf8");
  if (bytes.length > 64) {
    return { valid: false, error: "MemoTooLong" };
  }
  for (const b of bytes) {
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a) || b === 0x7f) {
      return { valid: false, error: "MemoTooLong" };
    }
  }
  return { valid: true };
}

describe("Contract Memo Validation (#1360)", () => {
  describe("Error Catalog & ABI Parity", () => {
    it("maps error code 313 to MemoTooLong across all error registries", () => {
      expect(PAYMENT_ERROR_NAMES[313]).toBe("MemoTooLong");
      expect(PAYMENT_ERROR_DISCRIMINANTS["MemoTooLong"]).toBe(313);
      expect(PaymentErrorCode.MemoTooLong).toBe(313);
      expect(ERROR_MESSAGES[313]).toContain("Payment memo exceeds maximum length");
      expect(PAYMENT_ERROR_MESSAGES[313]).toContain("Payment memo exceeds maximum length");
    });

    it("decodes contract error 313 in decodeContractError", () => {
      expect(decodeContractError("Error(Contract, #313)")).toBe(
        "Payment memo exceeds maximum length or contains invalid control characters"
      );
      expect(decodeContractError("313")).toBe(
        "Payment memo exceeds maximum length or contains invalid control characters"
      );
    });

    it("includes MemoTooLong in getContractErrorCatalog", () => {
      const catalog = getContractErrorCatalog();
      const entry = catalog.find((e) => e.code === "313");
      expect(entry).toBeDefined();
      expect(entry?.message).toContain("Payment memo exceeds maximum length");
    });
  });

  describe("Memo Text Validation Invariants", () => {
    it("accepts empty memo, 64-byte boundary, and valid UTF-8 strings", () => {
      // Empty string (0 bytes)
      expect(validateMemoText("").valid).toBe(true);

      // Exactly 64 ASCII bytes
      const boundary64 = "A".repeat(64);
      expect(Buffer.from(boundary64, "utf8").length).toBe(64);
      expect(validateMemoText(boundary64).valid).toBe(true);

      // Multi-byte UTF-8 string <= 64 bytes
      const utf8String = "OphirPay 🚀 Payment";
      expect(Buffer.from(utf8String, "utf8").length).toBeLessThanOrEqual(64);
      expect(validateMemoText(utf8String).valid).toBe(true);

      // Tab and newline allowed whitespace
      expect(validateMemoText("Line 1\nLine 2\tTabbed").valid).toBe(true);
    });

    it("rejects memos exceeding 64 bytes", () => {
      const oversized = "A".repeat(65);
      expect(Buffer.from(oversized, "utf8").length).toBe(65);
      const res = validateMemoText(oversized);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("MemoTooLong");
    });

    it("rejects memos containing ASCII control characters or DEL", () => {
      // ASCII 0x01 (SOH)
      expect(validateMemoText("bad\x01memo").valid).toBe(false);
      // ASCII 0x00 (NUL)
      expect(validateMemoText("null\x00byte").valid).toBe(false);
      // ASCII 0x1F (US)
      expect(validateMemoText("unit\x1Fsep").valid).toBe(false);
      // ASCII 0x7F (DEL)
      expect(validateMemoText("delete\x7Fchar").valid).toBe(false);
    });
  });
});
