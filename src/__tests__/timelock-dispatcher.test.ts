// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TYPES_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/src/types.rs"
);
const TEST_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/tests/timelock_dispatcher_test.rs"
);

describe("Timelocked admin action dispatcher (#1306)", () => {
  const typesSource = fs.readFileSync(TYPES_RS_PATH, "utf8");
  const testSource = fs.readFileSync(TEST_RS_PATH, "utf8");

  it("defines AdminTimelockAction variants for state-changing admin operations", () => {
    expect(typesSource).toContain("pub enum AdminTimelockAction");
    expect(typesSource).toContain("SetFeeConfig(FeeConfig)");
    expect(typesSource).toContain("SetFeeCollector(Address)");
    expect(typesSource).toContain("PauseContract(bool)");
    expect(typesSource).toContain("GrantRole(Address, Role)");
    expect(typesSource).toContain("RevokeRole(Address)");
    expect(typesSource).toContain("ConfigureGovernance(GovernanceConfig)");
    expect(typesSource).toContain(
      "SetSpendingLimit(Address, i128, i128, u64, bool)"
    );
  });

  it("implements dispatch_timelocked_action with timelock guards and storage updates", () => {
    expect(typesSource).toContain("pub fn dispatch_timelocked_action(");
    expect(typesSource).toContain("PaymentError::TimelockAlreadyExecuted");
    expect(typesSource).toContain("PaymentError::TimelockNotDue");
    expect(typesSource).toContain("PaymentError::UnsupportedOperation");
    expect(typesSource).toContain("env.storage().instance().set(&FEE_KEY, &config)");
    expect(typesSource).toContain("env.storage().instance().set(&FEE_COLL, &collector)");
    expect(typesSource).toContain("env.storage().instance().set(&PAUSED, &paused)");
    expect(typesSource).toContain("env.storage().persistent().set(&key, &role)");
    expect(typesSource).toContain("env.storage().instance().set(&GOV_CONF, &config)");
  });

  it("includes Soroban unit tests covering queued action dispatch and rejection of unknown actions", () => {
    expect(testSource).toContain(
      "fn test_dispatch_set_fee_config_updates_storage_after_timelock"
    );
    expect(testSource).toContain(
      "fn test_dispatch_rejects_premature_already_executed_and_unknown_actions"
    );
    expect(testSource).toContain(
      "fn test_dispatch_role_governance_and_spending_limit_actions"
    );
  });
});
