// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_ERROR_MAP } from "@/lib/contract-errors";
import { PaymentErrorCode, PAYMENT_ERROR_MESSAGES } from "@/types/contract-abi";

const ROOT = resolve(__dirname, "../..");
const ERRORS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/errors.rs"),
  "utf-8",
);
const CONTRACT_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/contract.rs"),
  "utf-8",
);
const INTEGRATION_TESTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/tests/integration_tests.rs"),
  "utf-8",
);

describe("Strictly positive threshold and non-empty signers in set_multisig_config (#1355)", () => {
  it("defines InvalidThreshold (310) and EmptySignersList (311) in Rust and TypeScript catalogs", () => {
    expect(ERRORS_RS).toContain("InvalidThreshold = 310,");
    expect(ERRORS_RS).toContain("EmptySignersList = 311,");

    expect(PaymentErrorCode.InvalidThreshold).toBe(310);
    expect(PaymentErrorCode.EmptySignersList).toBe(311);
    expect(PAYMENT_ERROR_MESSAGES[310]).toContain("strictly positive");
    expect(PAYMENT_ERROR_MESSAGES[311]).toContain("cannot be empty");
    expect(CONTRACT_ERROR_MAP["310"]).toContain("strictly positive");
    expect(CONTRACT_ERROR_MAP["311"]).toContain("cannot be empty");
  });

  it("enforces signers.is_empty() and threshold == 0 checks in set_multisig_config and execute_approved_payment", () => {
    expect(CONTRACT_RS).toContain("if signers.is_empty() {\n            return Err(PaymentError::EmptySignersList);\n        }"
      .replace(/\n/g, CONTRACT_RS.includes("\r\n") ? "\r\n" : "\n"));
    expect(CONTRACT_RS).toContain("return Err(PaymentError::EmptySignersList);");
    expect(CONTRACT_RS).toContain("return Err(PaymentError::InvalidThreshold);");
  });

  it("includes Soroban integration test covering zero-threshold and empty-signers submissions", () => {
    expect(INTEGRATION_TESTS_RS).toContain(
      "fn test_set_multisig_config_rejects_zero_threshold_and_empty_signers()",
    );
  });
});
