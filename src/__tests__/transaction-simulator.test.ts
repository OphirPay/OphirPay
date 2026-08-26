// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from 'vitest';
import { simulatePayment } from '@/lib/transaction-simulator';

// Mock the stellar module to avoid actual Horizon calls
vi.mock('@/lib/stellar', () => ({
  getHorizonServer: vi.fn(),
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

describe('transaction-simulator', () => {
  describe('simulatePayment', () => {
    it('returns error when loadAccount fails', async () => {
      const { getHorizonServer } = await import('@/lib/stellar');
      const mockServer = {
        loadAccount: vi.fn().mockRejectedValue(new Error('Account not found')),
        fetchBaseFee: vi.fn(),
      };
      vi.mocked(getHorizonServer).mockReturnValue(mockServer as unknown as ReturnType<typeof getHorizonServer>);

      const result = await simulatePayment({
        sourcePublicKey: 'GABC',
        destination: 'GDEF',
        amount: '100',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Account not found');
      expect(result.fee).toBe('100');
      expect(result.operations).toBe(1);
    });

    it('returns error for unknown exception type', async () => {
      const { getHorizonServer } = await import('@/lib/stellar');
      const mockServer = {
        loadAccount: vi.fn().mockRejectedValue('unknown error'),
        fetchBaseFee: vi.fn(),
      };
      vi.mocked(getHorizonServer).mockReturnValue(mockServer as unknown as ReturnType<typeof getHorizonServer>);

      const result = await simulatePayment({
        sourcePublicKey: 'GABC',
        destination: 'GDEF',
        amount: '100',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown simulation error');
      expect(result.fee).toBe('100');
      expect(result.operations).toBe(1);
    });

    it('returns error for network failure', async () => {
      const { getHorizonServer } = await import('@/lib/stellar');
      const mockServer = {
        loadAccount: vi.fn().mockRejectedValue(new Error('Network Error')),
        fetchBaseFee: vi.fn(),
      };
      vi.mocked(getHorizonServer).mockReturnValue(mockServer as unknown as ReturnType<typeof getHorizonServer>);

      const result = await simulatePayment({
        sourcePublicKey: 'GABC',
        destination: 'GDEF',
        amount: '100',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network Error');
    });

    it('returns error for timeout', async () => {
      const { getHorizonServer } = await import('@/lib/stellar');
      const mockServer = {
        loadAccount: vi.fn().mockRejectedValue(new Error('Timeout')),
        fetchBaseFee: vi.fn(),
      };
      vi.mocked(getHorizonServer).mockReturnValue(mockServer as unknown as ReturnType<typeof getHorizonServer>);

      const result = await simulatePayment({
        sourcePublicKey: 'GABC',
        destination: 'GDEF',
        amount: '100',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout');
    });

    it('returns error with proper fee fallback on catch', async () => {
      const { getHorizonServer } = await import('@/lib/stellar');
      const mockServer = {
        loadAccount: vi.fn().mockRejectedValue(new Error('Stellar error')),
        fetchBaseFee: vi.fn(),
      };
      vi.mocked(getHorizonServer).mockReturnValue(mockServer as unknown as ReturnType<typeof getHorizonServer>);

      const result = await simulatePayment({
        sourcePublicKey: 'GABC',
        destination: 'GDEF',
        amount: '50.5',
      });

      expect(result.success).toBe(false);
      expect(result.fee).toBe('100');
      expect(result.operations).toBe(1);
    });
  });
});
