// SPDX-License-Identifier: MIT

/**
 * Static verification and regression guard for refund lifecycle pause checks (issue #1282).
 *
 * Asserts that `approve_refund`, `reject_refund`, and `process_refund` in
 * `contracts/ophirpay/src/contract.rs` are protected by `require_not_paused`
 * circuit breaker guards to ensure refund settlements are properly halted
 * during an emergency pause.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

describe("Refund Lifecycle Pause Guards (Issue #1282)", () => {
  it("contracts/ophirpay/src/contract.rs exists", () => {
    expect(existsSync(join(root, "contracts/ophirpay/src/contract.rs"))).toBe(true);
  });

  it("guards approve_refund with require_not_paused before require_owner", () => {
    const contract = read("contracts/ophirpay/src/contract.rs");
    const approveMatch = contract.match(/pub fn approve_refund[\s\S]*?\{([\s\S]*?)let mut refund/);
    expect(approveMatch).not.toBeNull();
    const body = approveMatch![1];

    expect(body).toContain("require_not_paused(&env, PauseScope::Refunds)?;");
    expect(body.indexOf("require_not_paused(&env, PauseScope::Refunds)?;")).toBeLessThan(
      body.indexOf("require_owner(&env, &caller)?;")
    );
  });

  it("guards reject_refund with require_not_paused before require_owner", () => {
    const contract = read("contracts/ophirpay/src/contract.rs");
    const rejectMatch = contract.match(/pub fn reject_refund[\s\S]*?\{([\s\S]*?)let mut refund/);
    expect(rejectMatch).not.toBeNull();
    const body = rejectMatch![1];

    expect(body).toContain("require_not_paused(&env, PauseScope::Refunds)?;");
    expect(body.indexOf("require_not_paused(&env, PauseScope::Refunds)?;")).toBeLessThan(
      body.indexOf("require_owner(&env, &caller)?;")
    );
  });

  it("guards process_refund with require_not_paused before require_owner", () => {
    const contract = read("contracts/ophirpay/src/contract.rs");
    const processMatch = contract.match(/pub fn process_refund[\s\S]*?\{([\s\S]*?)let mut refund/);
    expect(processMatch).not.toBeNull();
    const body = processMatch![1];

    expect(body).toContain("require_not_paused(&env, PauseScope::Refunds)?;");
    expect(body.indexOf("require_not_paused(&env, PauseScope::Refunds)?;")).toBeLessThan(
      body.indexOf("require_owner(&env, &caller)?;")
    );
  });

  it("verifies integration test coverage in integration_tests.rs", () => {
    const testSource = read("contracts/ophirpay/tests/integration_tests.rs");
    expect(testSource).toContain("fn test_paused_contract_blocks_refund_lifecycle");
    expect(testSource).toContain("try_approve_refund");
    expect(testSource).toContain("try_reject_refund");
    expect(testSource).toContain("try_process_refund");
  });
});
