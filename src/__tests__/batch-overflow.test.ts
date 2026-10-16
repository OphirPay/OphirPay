import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Issue #1283: checked_add for batch total accumulation in create_batch", () => {
  const contractPath = path.resolve(__dirname, "../../contracts/ophirpay/src/contract.rs");
  const errorsPath = path.resolve(__dirname, "../../contracts/ophirpay/src/errors.rs");
  const integrationTestsPath = path.resolve(__dirname, "../../contracts/ophirpay/tests/integration_tests.rs");

  it("ensures create_batch uses checked_add instead of += for total_amount accumulation", () => {
    const contractSrc = fs.readFileSync(contractPath, "utf8");
    // Ensure checked_add is used for total_amount
    expect(contractSrc).toMatch(/total_amount\s*=\s*total_amount\s*\.checked_add\s*\(\s*amount\s*\)\s*\.ok_or\(/);
    // Ensure raw unchecked addition is not used
    expect(contractSrc).not.toMatch(/total_amount\s*\+=\s*amount/);
  });

  it("ensures PaymentError exposes ArithmeticOverflow alias for MathOverflow", () => {
    const errorsSrc = fs.readFileSync(errorsPath, "utf8");
    expect(errorsSrc).toMatch(/pub\s+const\s+ArithmeticOverflow:\s*PaymentError\s*=\s*PaymentError::MathOverflow;/);
  });

  it("ensures integration tests verify batch total overflow with large amounts", () => {
    const testsSrc = fs.readFileSync(integrationTestsPath, "utf8");
    expect(testsSrc).toContain("test_batch_empty_and_overflow_errors");
    expect(testsSrc).toContain("ovf_amounts.push_back(i128::MAX - 10);");
    expect(testsSrc).toContain("PaymentError::ArithmeticOverflow");
  });
});
