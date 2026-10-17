// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const TYPES_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/types.rs"),
  "utf-8",
);
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
const INTEGRATION_TESTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/tests/integration_tests.rs"),
  "utf-8",
);

describe("Granular contract capability pause bitflags (#1358)", () => {
  it("defines PAUSE_PAYMENTS, PAUSE_ESCROWS, PAUSE_STREAMS, PAUSE_GOVERNANCE, and PAUSE_ALL in types.rs", () => {
    expect(TYPES_RS).toContain("pub const PAUSE_PAYMENTS: u32 = 1;");
    expect(TYPES_RS).toContain("pub const PAUSE_ESCROWS: u32 = 2;");
    expect(TYPES_RS).toContain("pub const PAUSE_STREAMS: u32 = 4;");
    expect(TYPES_RS).toContain("pub const PAUSE_GOVERNANCE: u32 = 8;");
    expect(TYPES_RS).toContain(
      "pub const PAUSE_ALL: u32 = PAUSE_PAYMENTS | PAUSE_ESCROWS | PAUSE_STREAMS | PAUSE_GOVERNANCE;",
    );
  });

  it("stores PAUSE_FLAGS and enforces require_subsystem_active in storage.rs and events.rs", () => {
    expect(STORAGE_RS).toContain('pub const PAUSE_FLAGS: Symbol = symbol_short!("P_FLAGS");');
    expect(EVENTS_RS).toContain(
      "pub fn require_subsystem_active(env: &Env, flag: u32) -> Result<(), PaymentError>",
    );
    expect(EVENTS_RS).toContain("pub fn get_stored_pause_flags(env: &Env) -> u32");
    expect(EVENTS_RS).toContain("require_subsystem_active(env, flag)?;");
  });

  it("exposes set_subsystem_pause, get_pause_flags, and is_subsystem_paused in contract.rs", () => {
    expect(CONTRACT_RS).toContain("pub fn set_subsystem_pause(");
    expect(CONTRACT_RS).toContain("pub fn get_pause_flags(env: Env) -> u32");
    expect(CONTRACT_RS).toContain(
      "pub fn is_subsystem_paused(env: Env, subsystem: u32) -> Result<bool, PaymentError>",
    );
    expect(CONTRACT_RS).toContain("env.storage().instance().set(&PAUSE_FLAGS, &PAUSE_ALL);");
    expect(CONTRACT_RS).toContain("env.storage().instance().set(&PAUSE_FLAGS, &0u32);");
  });

  it("includes Soroban integration test verifying subsystem isolation and bitwise flags", () => {
    expect(INTEGRATION_TESTS_RS).toContain(
      "fn test_subsystem_pause_bitflags_isolate_payments_from_escrows_and_streams()",
    );
  });
});
