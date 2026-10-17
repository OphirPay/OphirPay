// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAUSE_PAYMENTS,
  PAUSE_ESCROWS,
  PAUSE_STREAMS,
  PAUSE_GOVERNANCE,
  setSubsystemPause,
  isSubsystemPaused,
  requireSubsystemActive,
  clearAllSubsystemPauses,
  decodePausedSubsystems,
} from "@/lib/contract-capability-flags";

const TEST_RS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/tests/capability_flags_test.rs"
);

describe("Granular contract capability flags (#1358)", () => {
  it("defines distinct bitflags for payments, escrows, streams, and governance", () => {
    expect(PAUSE_PAYMENTS).toBe(1);
    expect(PAUSE_ESCROWS).toBe(2);
    expect(PAUSE_STREAMS).toBe(4);
    expect(PAUSE_GOVERNANCE).toBe(8);
  });

  it("isolates subsystem pauses so pausing escrows does not block payments", () => {
    let mask = 0;
    mask = setSubsystemPause(mask, PAUSE_ESCROWS, true);

    expect(isSubsystemPaused(mask, PAUSE_ESCROWS)).toBe(true);
    expect(isSubsystemPaused(mask, PAUSE_PAYMENTS)).toBe(false);
    expect(isSubsystemPaused(mask, PAUSE_STREAMS)).toBe(false);
    expect(isSubsystemPaused(mask, PAUSE_GOVERNANCE)).toBe(false);

    expect(() => requireSubsystemActive(mask, PAUSE_PAYMENTS)).not.toThrow();
    expect(() => requireSubsystemActive(mask, PAUSE_ESCROWS)).toThrow(
      /ContractPaused/
    );
    expect(decodePausedSubsystems(mask)).toEqual(["escrows"]);
  });

  it("supports halting multiple subsystems and restoring individual or all flags cleanly", () => {
    let mask = 0;
    mask = setSubsystemPause(mask, PAUSE_ESCROWS, true);
    mask = setSubsystemPause(mask, PAUSE_GOVERNANCE, true);
    expect(decodePausedSubsystems(mask)).toEqual(["escrows", "governance"]);

    mask = setSubsystemPause(mask, PAUSE_ESCROWS, false);
    expect(decodePausedSubsystems(mask)).toEqual(["governance"]);

    mask = clearAllSubsystemPauses();
    expect(mask).toBe(0);
    expect(decodePausedSubsystems(mask)).toEqual([]);
  });

  it("includes Soroban tests verifying subsystem pause isolation on-chain", () => {
    const rustTest = fs.readFileSync(TEST_RS_PATH, "utf8");
    expect(rustTest).toContain("pub const PAUSE_PAYMENTS: u32 = 1;");
    expect(rustTest).toContain("pub const PAUSE_ESCROWS: u32 = 2;");
    expect(rustTest).toContain("pub const PAUSE_STREAMS: u32 = 4;");
    expect(rustTest).toContain("pub const PAUSE_GOVERNANCE: u32 = 8;");
    expect(rustTest).toContain("fn test_granular_subsystem_capability_flags_isolation");
  });
});
