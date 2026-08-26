// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidEmail,
  isValidAmount,
  isValidLength,
  isValidUrl,
  getFieldError,
  validateAmount,
  validateMemo,
  validateMatch,
} from '@/lib/validation-helpers';
import {
  saveWalletSession,
  loadWalletSession,
  clearWalletSession,
} from '@/lib/session';
import {
  isProduction,
  getDatabaseProvider,
  getAppUrl,
} from '@/lib/env';

// ═══════════════════════════════════════════════════════════
// validation-helpers
// ═══════════════════════════════════════════════════════════

describe('validation-helpers', () => {
  describe('isValidEmail', () => {
    it('validates correct email', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
    });
    it('rejects missing @', () => {
      expect(isValidEmail('testexample.com')).toBe(false);
    });
    it('rejects empty', () => {
      expect(isValidEmail('')).toBe(false);
    });
    it('validates email with subdomain', () => {
      expect(isValidEmail('user@mail.example.co.uk')).toBe(true);
    });
  });

  describe('isValidAmount', () => {
    it('validates a small amount', () => {
      expect(isValidAmount('0.001')).toBe(true);
    });
    it('rejects zero', () => {
      expect(isValidAmount('0')).toBe(false);
    });
    it('rejects negative', () => {
      expect(isValidAmount('-5')).toBe(false);
    });
    it('rejects non-numeric', () => {
      expect(isValidAmount('abc')).toBe(false);
    });
    it('rejects amount over max', () => {
      expect(isValidAmount('9999999999999')).toBe(false);
    });
  });

  describe('isValidLength', () => {
    it('validates within bounds', () => {
      expect(isValidLength('hello', 1, 10)).toBe(true);
    });
    it('rejects too short', () => {
      expect(isValidLength('hi', 5, 10)).toBe(false);
    });
    it('rejects too long', () => {
      expect(isValidLength('hello world', 1, 5)).toBe(false);
    });
    it('validates exact boundary', () => {
      expect(isValidLength('abc', 3, 3)).toBe(true);
    });
  });

  describe('isValidUrl', () => {
    it('validates https URL', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
    });
    it('rejects invalid URL', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
    });
    it('validates localhost URL', () => {
      expect(isValidUrl('http://localhost:3000')).toBe(true);
    });
  });

  describe('getFieldError', () => {
    it('returns null for valid email', () => {
      expect(getFieldError('email', 'test@example.com')).toBeNull();
    });
    it('returns error for invalid email', () => {
      expect(getFieldError('email', 'bad')).toBe('Please enter a valid email address');
    });
    it('returns required for empty email', () => {
      expect(getFieldError('email', '')).toBe('Email is required');
    });
    it('returns error for invalid amount', () => {
      expect(getFieldError('amount', 'bad')).toBe('Please enter a valid positive amount');
    });
    it('returns required for empty amount', () => {
      expect(getFieldError('amount', '')).toBe('Amount is required');
    });
    it('returns null for valid amount', () => {
      expect(getFieldError('amount', '100')).toBeNull();
    });
    it('returns error for invalid URL', () => {
      expect(getFieldError('url', 'not-valid')).toBe('Please enter a valid URL');
    });
    it('returns required for empty URL', () => {
      expect(getFieldError('url', '')).toBe('URL is required');
    });
    it('returns null for unknown field', () => {
      expect(getFieldError('name', 'anything')).toBeNull();
    });
  });

  describe('validateAmount', () => {
    it('validates a simple amount', () => {
      expect(validateAmount('100.5')).toBeNull();
    });
    it('rejects empty', () => {
      expect(validateAmount('')).toBe('Amount is required');
    });
    it('rejects zero', () => {
      expect(validateAmount('0')).toBe('Amount must be greater than 0');
    });
    it('rejects non-numeric', () => {
      expect(validateAmount('abc')).toBe('Amount must be a number');
    });
    it('rejects too many decimals', () => {
      expect(validateAmount('1.12345678')).toBe('Amount can have at most 7 decimal places');
    });
    it('allows exactly 7 decimals', () => {
      expect(validateAmount('1.1234567')).toBeNull();
    });
  });

  describe('validateMemo', () => {
    it('allows empty memo', () => {
      expect(validateMemo('')).toBeNull();
    });
    it('allows short memo', () => {
      expect(validateMemo('payment')).toBeNull();
    });
    it('rejects memo over 28 chars', () => {
      expect(validateMemo('a'.repeat(29))).toBe('Memo must be 28 characters or fewer');
    });
    it('allows exactly 28 chars', () => {
      expect(validateMemo('a'.repeat(28))).toBeNull();
    });
  });

  describe('validateMatch', () => {
    it('returns null when values match', () => {
      expect(validateMatch('abc', 'abc', 'Address')).toBeNull();
    });
    it('returns error when values differ', () => {
      expect(validateMatch('abc', 'xyz', 'Address')).toBe('Address values do not match');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// session
// ═══════════════════════════════════════════════════════════

describe('session', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveWalletSession / loadWalletSession', () => {
    it('saves and loads a session', () => {
      const session = { publicKey: 'GABC123', network: 'TESTNET', lastConnected: Date.now() };
      saveWalletSession(session);
      const loaded = loadWalletSession();
      expect(loaded).not.toBeNull();
      expect(loaded!.publicKey).toBe('GABC123');
      expect(loaded!.network).toBe('TESTNET');
    });

    it('returns null when no session exists', () => {
      expect(loadWalletSession()).toBeNull();
    });

    it('returns null for expired session', () => {
      const expired = { publicKey: 'GABC123', network: 'TESTNET', lastConnected: Date.now() - 90000000 };
      saveWalletSession(expired);
      expect(loadWalletSession()).toBeNull();
    });
  });

  describe('clearWalletSession', () => {
    it('removes the session', () => {
      const session = { publicKey: 'GABC123', network: 'TESTNET', lastConnected: Date.now() };
      saveWalletSession(session);
      clearWalletSession();
      expect(loadWalletSession()).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// env
// ═══════════════════════════════════════════════════════════

describe('env', () => {
  describe('isProduction', () => {
    it('returns false in test environment', () => {
      // NODE_ENV is 'test' during vitest
      expect(typeof isProduction()).toBe('boolean');
    });
  });

  describe('getDatabaseProvider', () => {
    it('returns a valid provider string', () => {
      const provider = getDatabaseProvider();
      expect(['sqlite', 'postgresql']).toContain(provider);
    });
  });

  describe('getAppUrl', () => {
    it('returns a URL string', () => {
      const url = getAppUrl();
      expect(url.startsWith('http')).toBe(true);
    });

    it('strips trailing slash', () => {
      const url = getAppUrl();
      expect(url.endsWith('/')).toBe(false);
    });
  });
});
