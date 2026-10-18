// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  validateTimelockedActionExecution,
  isTimelockEnforced,
  setTimelockEnforced,
} from "@/lib/contract-advanced";
import { decodeContractError, getContractErrorCatalog } from "@/lib/contract-errors";

describe("Timelocked Action Dispatcher & Enforcement (#1306)", () => {
  describe("validateTimelockedActionExecution", () => {
    it("allows execution when delay has elapsed and action is not yet executed", () => {
      const action = {
        executed: false,
        unlocksAt: 1_000_000,
      };
      const now = 1_000_001;

      const result = validateTimelockedActionExecution(action, now);
      expect(result.canExecute).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("allows execution exactly at the unlocks_at boundary", () => {
      const action = {
        executed: false,
        unlocksAt: 1_000_000,
      };
      const now = 1_000_000;

      const result = validateTimelockedActionExecution(action, now);
      expect(result.canExecute).toBe(true);
    });

    it("rejects execution before timelock delay has elapsed", () => {
      const action = {
        executed: false,
        unlocksAt: 1_000_000,
      };
      const now = 999_999;

      const result = validateTimelockedActionExecution(action, now);
      expect(result.canExecute).toBe(false);
      expect(result.reason).toContain("not due yet");
    });

    it("rejects execution when action was already executed", () => {
      const action = {
        executed: true,
        unlocksAt: 1_000_000,
      };
      const now = 1_000_500;

      const result = validateTimelockedActionExecution(action, now);
      expect(result.canExecute).toBe(false);
      expect(result.reason).toContain("already been executed");
    });
  });

  describe("Contract error catalog parity for TimelockRequired (310)", () => {
    it("decodes TimelockRequired error code 310", () => {
      const message = decodeContractError("Error(Contract, #310)");
      expect(message).toBeDefined();
      expect(message.toLowerCase()).toContain("timelock");
    });

    it("includes TimelockRequired in error catalog", () => {
      const catalog = getContractErrorCatalog();
      const entry = catalog.find((e) => e.code === "310");
      expect(entry).toBeDefined();
      expect(entry?.message.toLowerCase()).toContain("timelock");
    });
  });

  describe("Function exports", () => {
    it("exports timelock enforcement helper functions", () => {
      expect(typeof isTimelockEnforced).toBe("function");
      expect(typeof setTimelockEnforced).toBe("function");
    });
  });
});
