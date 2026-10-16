import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Issue #1285: Deduplicate signers and enforce MaxSignersExceeded in set_multisig_config", () => {
  const contractPath = path.resolve(__dirname, "../../contracts/ophirpay/src/contract.rs");
  const errorsPath = path.resolve(__dirname, "../../contracts/ophirpay/src/errors.rs");
  const integrationTestsPath = path.resolve(__dirname, "../../contracts/ophirpay/tests/integration_tests.rs");

  it("ensures set_multisig_config checks MAX_MULTISIG_SIGNERS limit", () => {
    const contractSrc = fs.readFileSync(contractPath, "utf8");
    expect(contractSrc).toContain("MAX_MULTISIG_SIGNERS");
    expect(contractSrc).toMatch(/if\s+signers\.len\(\)\s*>\s*MAX_MULTISIG_SIGNERS/);
    expect(contractSrc).toContain("PaymentError::MaxSignersExceeded");
  });

  it("ensures set_multisig_config rejects duplicate signers with DuplicateSigner", () => {
    const contractSrc = fs.readFileSync(contractPath, "utf8");
    expect(contractSrc).toMatch(/if\s+unique_signers\.contains\(signer\.clone\(\)\)\s*\{\s*return\s+Err\(PaymentError::DuplicateSigner\);/);
  });

  it("ensures PaymentError defines DuplicateSigner", () => {
    const errorsSrc = fs.readFileSync(errorsPath, "utf8");
    expect(errorsSrc).toMatch(/pub\s+const\s+DuplicateSigner:\s*PaymentError\s*=\s*PaymentError::DuplicateRecipient;/);
  });

  it("ensures integration tests verify multisig config validation guards", () => {
    const testsSrc = fs.readFileSync(integrationTestsPath, "utf8");
    expect(testsSrc).toContain("test_multisig_config_validation_guards");
    expect(testsSrc).toContain("PaymentError::DuplicateSigner");
    expect(testsSrc).toContain("PaymentError::MaxSignersExceeded");
    expect(testsSrc).toContain("PaymentError::InvalidAmount");
  });
});
