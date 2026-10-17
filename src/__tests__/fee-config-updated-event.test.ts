// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const EVENTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/events.rs"),
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

describe("On-chain event when fee configuration and collector address are updated (#1349)", () => {
  it("defines FeeConfigUpdated struct and emit_fee_config_updated helper in events.rs", () => {
    expect(EVENTS_RS).toContain("pub struct FeeConfigUpdated {");
    expect(EVENTS_RS).toContain("pub previous_collector: Option<Address>,");
    expect(EVENTS_RS).toContain("pub new_collector: Option<Address>,");
    expect(EVENTS_RS).toContain("pub previous_payment_fee_bps: u32,");
    expect(EVENTS_RS).toContain("pub new_payment_fee_bps: u32,");
    expect(EVENTS_RS).toContain("pub caller: Address,");
    expect(EVENTS_RS).toContain("pub fn emit_fee_config_updated(env: &Env, payload: &FeeConfigUpdated)");
    expect(EVENTS_RS).toContain('Symbol::new(env, "fee_config")');
    expect(EVENTS_RS).toContain('Symbol::new(env, "updated")');
  });

  it("emits FeeConfigUpdated in both set_fee_config and set_fee_collector in contract.rs", () => {
    const matches = CONTRACT_RS.match(/emit_fee_config_updated\(&env, &event_payload\);/g);
    expect(matches?.length).toBe(2);
    expect(CONTRACT_RS).toContain('"fee_collector_set"');
  });

  it("includes Soroban integration test verifying event emission, topics, and payload contents", () => {
    expect(INTEGRATION_TESTS_RS).toContain(
      "fn test_fee_config_and_collector_update_emits_on_chain_event()",
    );
  });
});
