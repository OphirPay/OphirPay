// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  PAUSE_PAYMENTS,
  PAUSE_ESCROWS,
  PAUSE_STREAMS,
  PAUSE_GOVERNANCE,
  PAUSE_RECURRING,
  PAUSE_REFUNDS,
  PAUSE_HOOKS,
  PAUSE_BATCHES,
  PAUSE_ALL,
  parseSubsystemFlags,
} from "@/lib/contract-advanced";

describe("Subsystem Pause Bitflags (#1358)", () => {
  it("defines unique power-of-two bitflags for each subsystem", () => {
    const flags = [
      PAUSE_PAYMENTS,
      PAUSE_ESCROWS,
      PAUSE_STREAMS,
      PAUSE_GOVERNANCE,
      PAUSE_RECURRING,
      PAUSE_REFUNDS,
      PAUSE_HOOKS,
      PAUSE_BATCHES,
    ];

    expect(PAUSE_PAYMENTS).toBe(1);
    expect(PAUSE_ESCROWS).toBe(2);
    expect(PAUSE_STREAMS).toBe(4);
    expect(PAUSE_GOVERNANCE).toBe(8);
    expect(PAUSE_RECURRING).toBe(16);
    expect(PAUSE_REFUNDS).toBe(32);
    expect(PAUSE_HOOKS).toBe(64);
    expect(PAUSE_BATCHES).toBe(128);

    // Verify each flag is distinct and pairwise disjoint
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        expect(flags[i] & flags[j]).toBe(0);
      }
    }

    expect(PAUSE_ALL).toBe(255);
  });

  describe("parseSubsystemFlags", () => {
    it("reports all subsystems active when flags mask is 0", () => {
      const statuses = parseSubsystemFlags(0);
      expect(statuses).toHaveLength(8);
      expect(statuses.every((s) => !s.paused)).toBe(true);
    });

    it("correctly isolates a single paused subsystem (Escrows)", () => {
      const statuses = parseSubsystemFlags(PAUSE_ESCROWS);
      const escrowStatus = statuses.find((s) => s.subsystem === PAUSE_ESCROWS);
      const paymentStatus = statuses.find((s) => s.subsystem === PAUSE_PAYMENTS);

      expect(escrowStatus?.paused).toBe(true);
      expect(paymentStatus?.paused).toBe(false);

      const pausedCount = statuses.filter((s) => s.paused).length;
      expect(pausedCount).toBe(1);
    });

    it("correctly reflects multiple independent paused subsystems", () => {
      const mask = PAUSE_PAYMENTS | PAUSE_STREAMS | PAUSE_GOVERNANCE;
      const statuses = parseSubsystemFlags(mask);

      expect(statuses.find((s) => s.subsystem === PAUSE_PAYMENTS)?.paused).toBe(true);
      expect(statuses.find((s) => s.subsystem === PAUSE_ESCROWS)?.paused).toBe(false);
      expect(statuses.find((s) => s.subsystem === PAUSE_STREAMS)?.paused).toBe(true);
      expect(statuses.find((s) => s.subsystem === PAUSE_GOVERNANCE)?.paused).toBe(true);
      expect(statuses.find((s) => s.subsystem === PAUSE_REFUNDS)?.paused).toBe(false);
    });

    it("reports all subsystems paused when mask is PAUSE_ALL", () => {
      const statuses = parseSubsystemFlags(PAUSE_ALL);
      expect(statuses.every((s) => s.paused)).toBe(true);
    });
  });
});
