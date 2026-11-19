import { describe, it, expect } from 'vitest';
import { formatStellarAmount } from '../lib/stellar/format';

describe('formatStellarAmount - Boundary Values', () => {
  // 1. Test Zero
  it('should format zero correctly', () => {
    expect(formatStellarAmount(0)).toBe('0');
    expect(formatStellarAmount(0n)).toBe('0');
    expect(formatStellarAmount('0')).toBe('0');
  });

  // 2. Test Minimum Non-Zero Stroop (0.0000001)
  it('should format the minimum non-zero stroop amount (1 stroop)', () => {
    // 1 stroop = 0.0000001
    expect(formatStellarAmount(1)).toBe('0.0000001');
    expect(formatStellarAmount(1n)).toBe('0.0000001');
    expect(formatStellarAmount('1')).toBe('0.0000001');
  });

  // 3. Test Negative Numbers
  it('should handle negative numbers correctly', () => {
    expect(formatStellarAmount(-1)).toBe('-0.0000001');
    expect(formatStellarAmount(-10000000)).toBe('-1');
    expect(formatStellarAmount('-9223372036854775807')).toBe('-922337203685.4775807');
  });

  // 4. Test MAX_INT64 (9,223,372,036,854,775,807 stroops)
  it('should format MAX_INT64 without floating point overflow', () => {
    const MAX_INT64_STROOPS = '9223372036854775807';
    const expected = '922337203685.4775807';
    
    expect(formatStellarAmount(MAX_INT64_STROOPS)).toBe(expected);
    expect(formatStellarAmount(BigInt(MAX_INT64_STROOPS))).toBe(expected);
  });

  // 5. Test Branch Coverage (Edge Cases)
  it('should handle invalid inputs gracefully', () => {
    // @ts-expect-error - Testing runtime safety
    expect(formatStellarAmount(null)).toBe('0');
    // @ts-expect-error - Testing runtime safety
    expect(formatStellarAmount(undefined)).toBe('0');
    expect(formatStellarAmount('invalid')).toBe('0');
  });

  it('should format large whole numbers correctly', () => {
    expect(formatStellarAmount('10000000000000')).toBe('1000000');
  });

  it('should format values with exactly 7 digits (less than 1 unit)', () => {
    expect(formatStellarAmount('9999999')).toBe('0.9999999');
  });

  it('should format values with more than 7 digits', () => {
    expect(formatStellarAmount('123456789')).toBe('12.3456789');
  });
});
