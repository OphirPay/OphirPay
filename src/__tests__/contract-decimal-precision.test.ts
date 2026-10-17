// SPDX-License-Identifier: MIT
/**
 * Contract source & behavioral parity tests for Issue #1347:
 * Add validation for token decimal precision mismatch in record_payment.
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
const STORAGE_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "src",
  "storage.rs"
);
const INTEGRATION_TESTS_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "tests",
  "integration_tests.rs"
);

const DEFAULT_STELLAR_DECIMALS = 7;
const MAX_TOKEN_DECIMALS = 18;

/**
 * TypeScript reference mirror of `token_quantum_step` and `validate_token_decimal_precision`
 * in `contracts/ophirpay/src/contract.rs`.
 */
function validateTokenDecimalPrecision(
  decimals: number,
  amount: bigint
): { valid: boolean; quantumStep?: bigint; error?: PaymentError } {
  if (decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    return { valid: false, error: PaymentError.InvalidDecimalPrecision };
  }
  const quantumStep =
    decimals < DEFAULT_STELLAR_DECIMALS
      ? 10n ** BigInt(DEFAULT_STELLAR_DECIMALS - decimals)
      : 1n;
  if (quantumStep > 1n && amount % quantumStep !== 0n) {
    return {
      valid: false,
      quantumStep,
      error: PaymentError.InvalidDecimalPrecision,
    };
  }
  return { valid: true, quantumStep };
}

describe("Soroban contract token decimal precision validation (#1347)", () => {
  const contractRs = readFileSync(CONTRACT_RS_PATH, "utf8");
  const errorsRs = readFileSync(ERRORS_RS_PATH, "utf8");
  const storageRs = readFileSync(STORAGE_RS_PATH, "utf8");
  const integrationTestsRs = readFileSync(INTEGRATION_TESTS_RS_PATH, "utf8");

  it("defines TOKEN_DECIMALS_KEY, DEFAULT_STELLAR_DECIMALS = 7, and MAX_TOKEN_DECIMALS = 18", () => {
    expect(storageRs).toContain(
      'pub const TOKEN_DECIMALS_KEY: Symbol = symbol_short!("TOK_DEC");'
    );
    expect(contractRs).toMatch(
      /pub const DEFAULT_STELLAR_DECIMALS:\s*u32\s*=\s*7;/
    );
    expect(contractRs).toMatch(/pub const MAX_TOKEN_DECIMALS:\s*u32\s*=\s*18;/);
  });

  it("defines PaymentError::InvalidDecimalPrecision = 310 in Rust and synchronizes TypeScript catalogs", () => {
    expect(errorsRs).toMatch(/InvalidDecimalPrecision\s*=\s*310/);
    expect(PaymentError.InvalidDecimalPrecision).toBe(310);
    expect(PaymentErrorCode.InvalidDecimalPrecision).toBe(310);
    expect(CONTRACT_ERROR_MAP["310"]).toMatch(/decimal precision|quantum step/i);
    expect(decodeContractError("Error(Contract, #310)")).toBe(
      CONTRACT_ERROR_MAP["310"]
    );
  });

  it("implements validate_token_decimal_precision, set_token_decimals, and get_token_decimals in contract.rs", () => {
    expect(contractRs).toContain("pub fn validate_token_decimal_precision(");
    expect(contractRs).toContain("pub fn set_token_decimals(");
    expect(contractRs).toContain("pub fn get_token_decimals(");
    expect(contractRs).toContain(
      "validate_token_decimal_precision(&env, &asset, amount)?;"
    );
  });

  it("accepts standard 7-decimal XLM/USDC amounts and rejects sub-quantum or >18 decimal configurations", () => {
    // Standard 7-decimal SAC token allows 1-stroop precision
    expect(validateTokenDecimalPrecision(7, 12_345_678n)).toEqual({
      valid: true,
      quantumStep: 1n,
    });

    // 6-decimal token requires 10-stroop multiples
    expect(validateTokenDecimalPrecision(6, 1_000_010n)).toEqual({
      valid: true,
      quantumStep: 10n,
    });
    expect(validateTokenDecimalPrecision(6, 1_000_005n)).toEqual({
      valid: false,
      quantumStep: 10n,
      error: PaymentError.InvalidDecimalPrecision,
    });

    // 2-decimal token requires 100_000-stroop multiples
    expect(validateTokenDecimalPrecision(2, 500_000n)).toEqual({
      valid: true,
      quantumStep: 100_000n,
    });
    expect(validateTokenDecimalPrecision(2, 123_456n)).toEqual({
      valid: false,
      quantumStep: 100_000n,
      error: PaymentError.InvalidDecimalPrecision,
    });

    // >18 decimals rejected with InvalidDecimalPrecision
    expect(validateTokenDecimalPrecision(19, 1_000_000n)).toEqual({
      valid: false,
      error: PaymentError.InvalidDecimalPrecision,
    });
  });

  it("includes Rust integration tests covering standard 7-decimal and mismatched custom token decimals", () => {
    expect(integrationTestsRs).toContain(
      "fn test_record_payment_accepts_standard_7_decimal_sac_and_valid_custom_decimals()"
    );
    expect(integrationTestsRs).toContain(
      "fn test_record_payment_rejects_decimal_precision_mismatch_and_out_of_range_decimals()"
    );
    expect(integrationTestsRs).toContain("PaymentError::InvalidDecimalPrecision");
  });
});
