// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_ERROR_MAP } from "@/lib/contract-errors";

const ERRORS_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/src/errors.rs"
);
const TEST_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/tests/multisig_threshold_test.rs"
);

describe("Multisig strictly positive threshold and non-empty signers validation (#1355)", () => {
  const errorsSource = fs.readFileSync(ERRORS_RS_PATH, "utf8");
  const testSource = fs.readFileSync(TEST_RS_PATH, "utf8");

  it("defines InvalidThreshold and EmptySignersList error variants and syncs TS catalog", () => {
    expect(errorsSource).toContain("InvalidThreshold = 310");
    expect(errorsSource).toContain("EmptySignersList = 311");
    expect(CONTRACT_ERROR_MAP["310"]).toContain("Multisig threshold");
    expect(CONTRACT_ERROR_MAP["311"]).toContain("Multisig signers list");
  });

  it("enforces positive threshold and non-empty signers in validate_multisig_config", () => {
    expect(errorsSource).toContain("pub fn validate_multisig_config(");
    expect(errorsSource).toContain("if signers.is_empty()");
    expect(errorsSource).toContain("return Err(PaymentError::EmptySignersList);");
    expect(errorsSource).toContain("if threshold == 0 || threshold > signers.len()");
    expect(errorsSource).toContain("return Err(PaymentError::InvalidThreshold);");
  });

  it("includes Soroban unit tests covering zero-threshold and empty-signers rejection", () => {
    expect(testSource).toContain(
      "fn test_multisig_rejects_zero_threshold_and_empty_signers"
    );
    expect(testSource).toContain("Err(PaymentError::EmptySignersList)");
    expect(testSource).toContain("Err(PaymentError::InvalidThreshold)");
  });
});
