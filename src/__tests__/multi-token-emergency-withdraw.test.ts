// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const STORAGE_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/storage.rs"),
  "utf-8",
);
const EVENTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/events.rs"),
  "utf-8",
);
const CONTRACT_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/contract.rs"),
  "utf-8",
);
const INVARIANTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/spec/src/invariants.rs"),
  "utf-8",
);
const INTEGRATION_TESTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/tests/integration_tests.rs"),
  "utf-8",
);

describe("Multi-token balance integrity verification in emergency_withdraw (#1354)", () => {
  it("defines per-token locked balance storage namespace in storage.rs and events.rs", () => {
    expect(STORAGE_RS).toContain('pub const TOKEN_LOCKED_BALANCE: Symbol = symbol_short!("T_LOCKED");');
    expect(STORAGE_RS).toContain("pub enum DataKey {");
    expect(STORAGE_RS).toContain("TokenLockedBalance(Address)");

    expect(EVENTS_RS).toContain("pub fn add_token_locked(env: &Env, asset: &Address, delta: i128)");
    expect(EVENTS_RS).toContain("pub fn get_token_locked(env: &Env, asset: &Address) -> i128");
    expect(EVENTS_RS).toContain("add_locked(env, delta);");
  });

  it("tracks locked balances per token across escrows, streams, and governance deposits", () => {
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &deposit_asset, deposit_amount);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &proposal.deposit_asset, -proposal.deposit_amount);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &asset, amount);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &escrow.asset, -escrow.amount);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &asset, total_amount);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &stream.asset, -claimable);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &stream.asset, -earned_unclaimed);");
    expect(CONTRACT_RS).toContain("add_token_locked(&env, &stream.asset, -unvested);");
    expect(CONTRACT_RS).toContain("pub fn get_token_locked_balance(env: Env, asset: Address) -> i128");
  });

  it("enforces pre- and post-transfer per-token balance integrity in emergency_withdraw", () => {
    expect(CONTRACT_RS).toContain("let token_locked = get_token_locked(&env, &asset);");
    expect(CONTRACT_RS).toContain("if contract_balance < token_locked {");
    expect(CONTRACT_RS).toContain("let unlocked = contract_balance.saturating_sub(token_locked);");
    expect(CONTRACT_RS).toContain("let post_balance = token_client.balance(&contract_addr);");
    expect(CONTRACT_RS).toContain("if post_balance < token_locked {");
  });

  it("includes Kani invariant proof and Soroban multi-token integration tests", () => {
    expect(INVARIANTS_RS).toContain("fn multi_token_locked_balance_invariant()");
    expect(INTEGRATION_TESTS_RS).toContain(
      "fn test_emergency_withdraw_multi_token_isolation_and_balance_integrity()",
    );
  });
});
