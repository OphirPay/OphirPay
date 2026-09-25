import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Refund System & Reason-Code Analytics Documentation (Issue #772)", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const refundsDocPath = path.join(rootDir, "docs/REFUNDS.md");
  const contractRefPath = path.join(rootDir, "docs/CONTRACT_FUNCTION_REFERENCE.md");
  const apiCookbookPath = path.join(rootDir, "docs/API_COOKBOOK.md");

  it("verifies docs/REFUNDS.md exists and documents the full reason-code catalog", () => {
    expect(fs.existsSync(refundsDocPath)).toBe(true);
    const content = fs.readFileSync(refundsDocPath, "utf-8");

    // All 6 reason codes (0 to 5)
    expect(content).toContain("ProductDefect");
    expect(content).toContain("NonDelivery");
    expect(content).toContain("DuplicateCharge");
    expect(content).toContain("Unauthorized");
    expect(content).toContain("CustomerRequest");
    expect(content).toContain("Other");

    // Code indices
    expect(content).toMatch(/`0`[\s\S]*?ProductDefect/);
    expect(content).toMatch(/`1`[\s\S]*?NonDelivery/);
    expect(content).toMatch(/`2`[\s\S]*?DuplicateCharge/);
    expect(content).toMatch(/`3`[\s\S]*?Unauthorized/);
    expect(content).toMatch(/`4`[\s\S]*?CustomerRequest/);
    expect(content).toMatch(/`5`[\s\S]*?Other/);
  });

  it("verifies docs/REFUNDS.md documents authorization rules per transition matching contract code", () => {
    const content = fs.readFileSync(refundsDocPath, "utf-8");

    // request_refund
    expect(content).toContain("request_refund");
    expect(content).toContain("payment.payer");
    expect(content).toContain("payment.payee");
    expect(content).toContain("HIGH-1");
    expect(content).toContain("amount <= payment.amount");

    // approve_refund
    expect(content).toContain("approve_refund");
    expect(content).toContain("Contract Owner only");
    expect(content).toContain("require_owner");

    // reject_refund
    expect(content).toContain("reject_refund");

    // process_refund
    expect(content).toContain("process_refund");
    expect(content).toContain("acquire_reentrancy_lock");
    expect(content).toContain("MEDIUM-4");
  });

  it("verifies docs/REFUNDS.md documents the bounded analytics window and truncation semantics", () => {
    const content = fs.readFileSync(refundsDocPath, "utf-8");

    expect(content).toContain("get_reason_code_analytics");
    expect(content).toContain("most recent 100 refunds");
    expect(content).toContain("MEDIUM-2");
    expect(content).toContain("Truncation");
    expect(content).toContain("GET /api/refunds?analytics=true");
  });

  it("verifies docs/CONTRACT_FUNCTION_REFERENCE.md links to docs/REFUNDS.md and reflects correct authorization", () => {
    const content = fs.readFileSync(contractRefPath, "utf-8");

    expect(content).toContain("REFUNDS.md");
    expect(content).toContain("Contract Owner only");
    expect(content).toContain("most recent 100 refunds");
  });

  it("verifies docs/API_COOKBOOK.md includes refund reason code analytics and links to REFUNDS.md", () => {
    const content = fs.readFileSync(apiCookbookPath, "utf-8");

    expect(content).toContain("/api/refunds?analytics=true");
    expect(content).toContain("REFUNDS.md");
  });
});
