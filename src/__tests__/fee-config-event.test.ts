// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EVENTS_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/src/events.rs"
);
const TEST_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/tests/fee_config_event_test.rs"
);

describe("Fee configuration collector update event (#1349)", () => {
  const eventsSource = fs.readFileSync(EVENTS_RS_PATH, "utf8");
  const testSource = fs.readFileSync(TEST_RS_PATH, "utf8");

  it("defines FeeConfigUpdated payload with old/new collector and fee_bps", () => {
    expect(eventsSource).toContain("pub struct FeeConfigUpdated");
    expect(eventsSource).toContain("pub old_collector: Option<Address>");
    expect(eventsSource).toContain("pub new_collector: Address");
    expect(eventsSource).toContain("pub fee_bps: u32");
    expect(eventsSource).toContain("pub updated_by: Address");
    expect(eventsSource).toContain("pub timestamp: u64");
  });

  it("publishes (fee_config, updated) event in emit_fee_config_updated and update_fee_collector_with_event", () => {
    expect(eventsSource).toContain("pub fn emit_fee_config_updated(");
    expect(eventsSource).toContain(
      '(Symbol::new(env, "fee_config"), Symbol::new(env, "updated"))'
    );
    expect(eventsSource).toContain("pub fn update_fee_collector_with_event(");
    expect(eventsSource).toContain('"fee_collector_updated"');
  });

  it("includes Soroban tests asserting env.events().all() contains the (fee_config, updated) event", () => {
    expect(testSource).toContain(
      "fn test_fee_config_updated_event_emitted_with_topics_and_payload"
    );
    expect(testSource).toContain("env.events().all()");
    expect(testSource).toContain('Symbol::new(&env, "fee_config")');
    expect(testSource).toContain('Symbol::new(&env, "updated")');
  });
});
