import { describe, it, expect } from "vitest";
import { CONTRACT_ERROR_MAP, decodeContractError } from "@/lib/contract-errors";
import { PaymentError, PAYMENT_ERROR_NAMES } from "@/types/errors";

/**
 * Mirror of contract-level token quantum step logic for client-side validation (#1347).
 */
export function calculateTokenQuantumStep(decimals: number): bigint {
  if (decimals < 0 || decimals > 18) {
    throw new Error("InvalidDecimalPrecision: decimals must be between 0 and 18");
  }
  if (decimals < 7) {
    const diff = 7 - decimals;
    return BigInt(10 ** diff);
  }
  return BigInt(1);
}

/**
 * Validates an amount against a token's decimal precision.
 */
export function validateTokenDecimalAmount(amount: bigint, decimals: number): boolean {
  if (amount <= BigInt(0)) return false;
  if (decimals < 0 || decimals > 18) return false;
  const step = calculateTokenQuantumStep(decimals);
  return amount % step === BigInt(0);
}

describe("Token Decimal Precision (#1347)", () => {
  describe("Error Catalog Consistency", () => {
    it("maps error code 313 to InvalidDecimalPrecision", () => {
      expect(PaymentError.InvalidDecimalPrecision).toBe(313);
      expect(PAYMENT_ERROR_NAMES[313]).toBe("InvalidDecimalPrecision");
      expect(CONTRACT_ERROR_MAP["313"]).toContain("decimal precision");
      expect(decodeContractError("Error(Contract, #313)")).toContain("decimal precision");
    });
  });

  describe("Quantum Step Calculations", () => {
    it("returns step 1 for 7-decimal standard assets (XLM/USDC)", () => {
      expect(calculateTokenQuantumStep(7)).toBe(BigInt(1));
    });

    it("returns step 1 for high-precision assets (decimals >= 7 up to 18)", () => {
      expect(calculateTokenQuantumStep(8)).toBe(BigInt(1));
      expect(calculateTokenQuantumStep(18)).toBe(BigInt(1));
    });

    it("returns step 100,000 for 2-decimal fiat-like tokens (cents)", () => {
      // 10^(7 - 2) = 100,000 stroops
      expect(calculateTokenQuantumStep(2)).toBe(BigInt(100_000));
    });

    it("returns step 10,000,000 for 0-decimal indivisible assets", () => {
      // 10^(7 - 0) = 10,000,000 stroops
      expect(calculateTokenQuantumStep(0)).toBe(BigInt(10_000_000));
    });

    it("throws on invalid decimals (> 18 or < 0)", () => {
      expect(() => calculateTokenQuantumStep(19)).toThrow(/InvalidDecimalPrecision/);
      expect(() => calculateTokenQuantumStep(-1)).toThrow(/InvalidDecimalPrecision/);
    });
  });

  describe("Amount Validation Against Precision", () => {
    it("accepts any positive integer stroop for 7-decimal assets", () => {
      expect(validateTokenDecimalAmount(BigInt(1), 7)).toBe(true);
      expect(validateTokenDecimalAmount(BigInt(100), 7)).toBe(true);
      expect(validateTokenDecimalAmount(BigInt(10_000_000), 7)).toBe(true);
    });

    it("validates amounts strictly for 2-decimal assets", () => {
      // Multiples of 100,000 succeed (e.g. 500,000 stroops = 0.05 units)
      expect(validateTokenDecimalAmount(BigInt(500_000), 2)).toBe(true);
      expect(validateTokenDecimalAmount(BigInt(100_000), 2)).toBe(true);
      expect(validateTokenDecimalAmount(BigInt(10_000_000), 2)).toBe(true);

      // Sub-cent amounts fail (e.g. 500,050 stroops)
      expect(validateTokenDecimalAmount(BigInt(500_050), 2)).toBe(false);
      expect(validateTokenDecimalAmount(BigInt(1), 2)).toBe(false);
      expect(validateTokenDecimalAmount(BigInt(99_999), 2)).toBe(false);
    });

    it("validates amounts strictly for 0-decimal indivisible assets", () => {
      // Whole units succeed
      expect(validateTokenDecimalAmount(BigInt(10_000_000), 0)).toBe(true);
      expect(validateTokenDecimalAmount(BigInt(50_000_000), 0)).toBe(true);

      // Fractional units fail
      expect(validateTokenDecimalAmount(BigInt(5_000_000), 0)).toBe(false);
      expect(validateTokenDecimalAmount(BigInt(10_000_001), 0)).toBe(false);
    });

    it("rejects non-positive amounts", () => {
      expect(validateTokenDecimalAmount(BigInt(0), 7)).toBe(false);
      expect(validateTokenDecimalAmount(BigInt(-100), 7)).toBe(false);
    });
  });
});
