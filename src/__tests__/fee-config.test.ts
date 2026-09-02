// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  validateFeeBps, 
  validateFeeConfig, 
  MAX_FEE_BPS,
} from "@/lib/fee-config";

describe("Fee Configuration Validation", () => {
  describe("MAX_FEE_BPS", () => {
    it("should be 1000 (10%)", () => {
      expect(MAX_FEE_BPS).toBe(1000);
    });
  });

  describe("validateFeeBps", () => {
    it("accepts valid fee values", () => {
      expect(validateFeeBps(0)).toBe(true);
      expect(validateFeeBps(1)).toBe(true);
      expect(validateFeeBps(500)).toBe(true);
      expect(validateFeeBps(1000)).toBe(true);
    });

    it("rejects negative values", () => {
      expect(validateFeeBps(-1)).toBe(false);
      expect(validateFeeBps(-100)).toBe(false);
    });

    it("rejects values above maximum", () => {
      expect(validateFeeBps(1001)).toBe(false);
      expect(validateFeeBps(2000)).toBe(false);
      expect(validateFeeBps(10000)).toBe(false);
    });

    it("rejects non-integer values", () => {
      expect(validateFeeBps(1.5)).toBe(false);
      expect(validateFeeBps(0.1)).toBe(false);
      expect(validateFeeBps(999.9)).toBe(false);
    });

    it("rejects NaN and Infinity", () => {
      expect(validateFeeBps(NaN)).toBe(false);
      expect(validateFeeBps(Infinity)).toBe(false);
      expect(validateFeeBps(-Infinity)).toBe(false);
    });
  });

  describe("validateFeeConfig", () => {
    it("validates all fees correctly when valid", () => {
      const result = validateFeeConfig(100, 200, 300);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts boundary values", () => {
      const result = validateFeeConfig(0, 0, 0);
      expect(result.isValid).toBe(true);
      
      const maxResult = validateFeeConfig(1000, 1000, 1000);
      expect(maxResult.isValid).toBe(true);
    });

    it("returns errors for invalid payment fee", () => {
      const result = validateFeeConfig(1500, 200, 300);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Payment fee");
    });

    it("returns errors for invalid escrow fee", () => {
      const result = validateFeeConfig(100, -10, 300);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Escrow fee");
    });

    it("returns errors for invalid stream fee", () => {
      const result = validateFeeConfig(100, 200, 1500);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Stream fee");
    });

    it("returns multiple errors for multiple invalid fees", () => {
      const result = validateFeeConfig(1500, -10, 1500);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });
});