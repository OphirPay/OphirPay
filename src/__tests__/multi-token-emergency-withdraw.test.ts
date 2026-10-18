// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  verifyEmergencyWithdrawIntegrity,
  emergencyWithdraw,
  getTokenLockedBalance,
} from "@/lib/contract-advanced";

describe("Multi-Token Emergency Withdraw Integrity (#1354)", () => {
  describe("verifyEmergencyWithdrawIntegrity", () => {
    it("allows withdrawal when amount is within unlocked balance", () => {
      const contractBalance = BigInt(2000);
      const tokenLockedBalance = BigInt(1000);
      const withdrawAmount = BigInt(500);

      const result = verifyEmergencyWithdrawIntegrity(
        contractBalance,
        tokenLockedBalance,
        withdrawAmount,
      );

      expect(result.canWithdraw).toBe(true);
      expect(result.remainingUnlocked).toBe(BigInt(500));
      expect(result.reason).toBeUndefined();
    });

    it("allows full withdrawal of unlocked balance down to exact locked balance", () => {
      const contractBalance = BigInt(2000);
      const tokenLockedBalance = BigInt(1000);
      const withdrawAmount = BigInt(1000);

      const result = verifyEmergencyWithdrawIntegrity(
        contractBalance,
        tokenLockedBalance,
        withdrawAmount,
      );

      expect(result.canWithdraw).toBe(true);
      expect(result.remainingUnlocked).toBe(BigInt(0));
    });

    it("rejects withdrawal when amount exceeds unlocked balance", () => {
      const contractBalance = BigInt(2000);
      const tokenLockedBalance = BigInt(1000);
      const withdrawAmount = BigInt(1001);

      const result = verifyEmergencyWithdrawIntegrity(
        contractBalance,
        tokenLockedBalance,
        withdrawAmount,
      );

      expect(result.canWithdraw).toBe(false);
      expect(result.reason).toContain("exceeds unlocked token balance");
    });

    it("rejects non-positive withdrawal amounts", () => {
      const resZero = verifyEmergencyWithdrawIntegrity(
        BigInt(1000),
        BigInt(0),
        BigInt(0),
      );
      expect(resZero.canWithdraw).toBe(false);
      expect(resZero.reason).toContain("greater than zero");

      const resNegative = verifyEmergencyWithdrawIntegrity(
        BigInt(1000),
        BigInt(0),
        BigInt(-100),
      );
      expect(resNegative.canWithdraw).toBe(false);
      expect(resNegative.reason).toContain("greater than zero");
    });

    it("rejects withdrawal if contract balance is less than token locked balance", () => {
      const result = verifyEmergencyWithdrawIntegrity(
        BigInt(800),
        BigInt(1000),
        BigInt(100),
      );

      expect(result.canWithdraw).toBe(false);
      expect(result.reason).toContain("lower than token locked balance");
    });

    it("demonstrates multi-token isolation: Token A locks do not block Token B", () => {
      // Token A has 1,500 locked out of 2,000 balance
      const tokenABalance = BigInt(2000);
      const tokenALocked = BigInt(1500);

      // Token B has 0 locked out of 5,000 balance
      const tokenBBalance = BigInt(5000);
      const tokenBLocked = BigInt(0);

      // Owner can withdraw all 5,000 of Token B
      const resultB = verifyEmergencyWithdrawIntegrity(
        tokenBBalance,
        tokenBLocked,
        BigInt(5000),
      );
      expect(resultB.canWithdraw).toBe(true);
      expect(resultB.remainingUnlocked).toBe(BigInt(0));

      // But attempting to withdraw 600 of Token A is rejected (only 500 unlocked)
      const resultA = verifyEmergencyWithdrawIntegrity(
        tokenABalance,
        tokenALocked,
        BigInt(600),
      );
      expect(resultA.canWithdraw).toBe(false);
      expect(resultA.remainingUnlocked).toBe(BigInt(500));
    });
  });

  describe("emergencyWithdraw and getTokenLockedBalance functions", () => {
    it("exports emergencyWithdraw and getTokenLockedBalance functions", () => {
      expect(typeof emergencyWithdraw).toBe("function");
      expect(typeof getTokenLockedBalance).toBe("function");
    });
  });
});
