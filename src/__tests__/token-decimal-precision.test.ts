import { describe, it, expect } from 'vitest';
import { PaymentError } from '../types/errors';
import { CONTRACT_ERROR_MAP } from '../lib/contract-errors';

const DEFAULT_STELLAR_DECIMALS = 7;
const MAX_TOKEN_DECIMALS = 18;

export function tokenQuantumStep(decimals: number): bigint {
  if (decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new Error('InvalidDecimalPrecision');
  }
  if (decimals < DEFAULT_STELLAR_DECIMALS) {
    const exp = DEFAULT_STELLAR_DECIMALS - decimals;
    return BigInt(Math.pow(10, exp));
  }
  return BigInt(1);
}

export function validateTokenDecimalPrecision(amount: bigint, decimals: number): boolean {
  const step = tokenQuantumStep(decimals);
  if (step > BigInt(1) && amount % step !== BigInt(0)) {
    return false;
  }
  return true;
}

describe('Token Decimal Precision Validation (#1347)', () => {
  describe('Error Catalog Parity', () => {
    it('allocates PaymentError.InvalidDecimalPrecision as error code 312', () => {
      expect(PaymentError.InvalidDecimalPrecision).toBe(312);
      expect(CONTRACT_ERROR_MAP['312']).toBe('Payment amount violates token decimal precision constraints');
    });
  });

  describe('Quantum Step Calculation', () => {
    it('returns 1 for standard 7 decimals', () => {
      expect(tokenQuantumStep(7)).toBe(BigInt(1));
    });

    it('returns 1 for decimals greater than 7', () => {
      expect(tokenQuantumStep(8)).toBe(BigInt(1));
      expect(tokenQuantumStep(18)).toBe(BigInt(1));
    });

    it('returns 100_000 for 2 decimals (cents)', () => {
      expect(tokenQuantumStep(2)).toBe(BigInt(100000));
    });

    it('returns 10_000_000 for 0 decimals (indivisible)', () => {
      expect(tokenQuantumStep(0)).toBe(BigInt(10000000));
    });

    it('throws error for decimals exceeding max 18', () => {
      expect(() => tokenQuantumStep(19)).toThrow('InvalidDecimalPrecision');
    });
  });

  describe('Precision Enforcement', () => {
    it('accepts any positive integer stroops for standard 7 decimals', () => {
      expect(validateTokenDecimalPrecision(BigInt(1), 7)).toBe(true);
      expect(validateTokenDecimalPrecision(BigInt(12345678), 7)).toBe(true);
    });

    it('enforces cent precision for 2-decimal fiat token', () => {
      // 5 cents = 500_000 stroops -> valid
      expect(validateTokenDecimalPrecision(BigInt(500000), 2)).toBe(true);
      // 5 cents + 1 stroop = 500_001 stroops -> sub-cent violation
      expect(validateTokenDecimalPrecision(BigInt(500001), 2)).toBe(false);
    });

    it('enforces whole unit precision for 0-decimal token', () => {
      // 3 whole units = 30_000_000 stroops -> valid
      expect(validateTokenDecimalPrecision(BigInt(30000000), 0)).toBe(true);
      // Fractional unit = 10_500_000 stroops -> fractional violation
      expect(validateTokenDecimalPrecision(BigInt(10500000), 0)).toBe(false);
    });
  });
});
