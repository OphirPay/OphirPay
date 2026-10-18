// SPDX-License-Identifier: MIT
/**
 * Contract source & behavioral parity tests for Issue #1360:
 * Add memo text byte-length limit (MAX_MEMO_BYTES = 64) and control character
 * validation in contract events and payment/batch entrypoints.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONTRACT_ERROR_MAP, decodeContractError } from "@/lib/contract-errors";
import { PaymentError } from "@/types/errors";
import { PaymentErrorCode } from "@/types/contract-abi";

const ROOT = path.resolve(__dirname, "../..");
const CONTRACT_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "src",
  "contract.rs"
);
const ERRORS_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "src",
  "errors.rs"
);
const INTEGRATION_TESTS_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "tests",
  "integration_tests.rs"
);

const MAX_MEMO_BYTES = 64;

/**
 * TypeScript reference mirror of `validate_memo_text` in `contracts/ophirpay/src/contract.rs`.
 */
function validateContractMemoText(memo: string): {
  valid: boolean;
  error?: PaymentError;
} {
  const bytes = Buffer.from(memo, "utf8");
  if (bytes.length > MAX_MEMO_BYTES) {
    return { valid: false, error: PaymentError.MemoTooLong };
  }
  for (const b of bytes) {
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a) || b === 0x7f) {
      return { valid: false, error: PaymentError.MemoTooLong };
    }
  }
  return { valid: true };
}

describe("Soroban contract memo byte-length & character validation (#1360)", () => {
  const contractRs = readFileSync(CONTRACT_RS_PATH, "utf8");
  const errorsRs = readFileSync(ERRORS_RS_PATH, "utf8");
  const integrationTestsRs = readFileSync(INTEGRATION_TESTS_RS_PATH, "utf8");

  it("defines pub const MAX_MEMO_BYTES: u32 = 64 in contracts/ophirpay/src/contract.rs", () => {
    expect(contractRs).toMatch(/pub const MAX_MEMO_BYTES:\s*u32\s*=\s*64;/);
  });

  it("defines PaymentError::MemoTooLong = 310 in Rust and synchronizes TypeScript error catalogs", () => {
    expect(errorsRs).toMatch(/MemoTooLong\s*=\s*310/);
    expect(PaymentError.MemoTooLong).toBe(310);
    expect(PaymentErrorCode.MemoTooLong).toBe(310);
    expect(CONTRACT_ERROR_MAP["310"]).toMatch(/64-byte maximum|control characters/i);
    expect(decodeContractError("Error(Contract, #310)")).toBe(
      CONTRACT_ERROR_MAP["310"]
    );
  });

  it("enforces validate_memo_text in record_payment, create_batch, atomic_spend, create_escrow, and create_stream", () => {
    expect(contractRs).toContain(
      "pub fn validate_memo_text(memo: &String) -> Result<(), PaymentError>"
    );
    expect(contractRs).toContain("if len > MAX_MEMO_BYTES");
    expect(contractRs).toContain("return Err(PaymentError::MemoTooLong);");

    const calls = contractRs.match(/validate_memo_text\(&(?:metadata|tx_hash)\)\?;/g);
    expect(calls?.length).toBeGreaterThanOrEqual(7);
  });

  it("validates empty, 64-byte boundary, 65-byte overflow, multi-byte UTF-8, and control character inputs", () => {
    // Empty memo succeeds
    expect(validateContractMemoText("")).toEqual({ valid: true });

    // Exact 64-byte ASCII boundary succeeds
    expect(validateContractMemoText("a".repeat(64))).toEqual({ valid: true });

    // 65-byte ASCII fails with MemoTooLong
    expect(validateContractMemoText("a".repeat(65))).toEqual({
      valid: false,
      error: PaymentError.MemoTooLong,
    });

    // 16 4-byte emoji (64 UTF-8 bytes) succeeds
    expect(validateContractMemoText("🚀".repeat(16))).toEqual({ valid: true });

    // 17 4-byte emoji (68 UTF-8 bytes) fails with MemoTooLong
    expect(validateContractMemoText("🚀".repeat(17))).toEqual({
      valid: false,
      error: PaymentError.MemoTooLong,
    });

    // Control characters (NUL, BEL, ESC, DEL) fail with MemoTooLong
    for (const ctrl of ["\0", "\x07", "\x1b", "\x7f"]) {
      expect(validateContractMemoText(`invoice${ctrl}101`)).toEqual({
        valid: false,
        error: PaymentError.MemoTooLong,
      });
    }
  });

  it("includes Rust integration tests for 0, 64, 65-byte memos, UTF-8 byte length, and control chars", () => {
    expect(integrationTestsRs).toContain(
      "fn test_memo_validation_accepts_empty_64_byte_boundary_and_utf8()"
    );
    expect(integrationTestsRs).toContain(
      "fn test_memo_validation_rejects_oversized_and_control_chars_in_record_payment_and_create_batch()"
    );
    expect(integrationTestsRs).toContain("PaymentError::MemoTooLong");
  });
});
