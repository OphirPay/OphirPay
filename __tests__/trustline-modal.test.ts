import { describe, it, expect, vi } from 'vitest';
import {
  isValidAssetCode,
  isValidStellarPublicKey,
  buildChangeTrustTransaction,
  DEFAULT_TRUSTLINE_LIMIT,
} from '@/lib/stellar-transactions';

describe('Stellar Custom Asset Trustline (#1384)', () => {
  const validUserKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
  const validIssuerKey = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  describe('Validation Helpers', () => {
    it('validates 1 to 12 alphanumeric asset codes', () => {
      expect(isValidAssetCode('USDC')).toBe(true);
      expect(isValidAssetCode('XLM')).toBe(true);
      expect(isValidAssetCode('EURC')).toBe(true);
      expect(isValidAssetCode('LONGTOKEN123')).toBe(true);

      // Invalid codes
      expect(isValidAssetCode('')).toBe(false);
      expect(isValidAssetCode('TOO_LONG_ASSET_CODE')).toBe(false);
      expect(isValidAssetCode('TOKEN-DASH')).toBe(false);
      expect(isValidAssetCode('TOKEN$')).toBe(false);
    });

    it('validates 56-character Stellar public keys starting with G', () => {
      expect(isValidStellarPublicKey(validUserKey)).toBe(true);
      expect(isValidStellarPublicKey(validIssuerKey)).toBe(true);

      // Invalid keys
      expect(isValidStellarPublicKey('')).toBe(false);
      expect(isValidStellarPublicKey('G12345')).toBe(false);
      expect(isValidStellarPublicKey('SAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7')).toBe(false); // S-prefix secret
      expect(isValidStellarPublicKey('CAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7')).toBe(false); // C-prefix contract
    });
  });

  describe('Default Configuration', () => {
    it('provides standard maximum trustline limit', () => {
      expect(DEFAULT_TRUSTLINE_LIMIT).toBe('922337203685.4775807');
    });
  });
});
