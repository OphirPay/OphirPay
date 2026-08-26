// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { ERRORS } from '@/lib/error-messages';
import { SUCCESS_MESSAGES } from '@/lib/success-messages';
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from '@/lib/page-titles';
import { ARIA } from '@/lib/aria-labels';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { ROUTES, API_ROUTES } from '@/lib/route-paths';
import { Z_INDEX } from '@/lib/z-index';
import { RETRY_CONFIG } from '@/lib/retry-config';
import { BREAKPOINTS, MEDIA } from '@/lib/responsive';
import { FEATURE_FLAGS, isFeatureEnabled } from '@/lib/feature-flags';
import { checkBrowserSupport } from '@/lib/browser-check';
import { isPermissionRequested, NOTIFY, sendNotification } from '@/lib/notifications';
import { getNetworkStatus, isMainnet } from '@/lib/network';
import { getSecurityHeaders, getCorsHeaders } from '@/lib/headers';
import { APP, STELLAR, UI, API } from '@/lib/constants';
import { buildTxSummary, buildBatchSummary, shortenAddress, buildEventMessage } from '@/lib/string-builder';

describe('error-messages', () => {
  it('has all expected error keys', () => {
    expect(ERRORS.WALLET_NOT_INSTALLED).toContain('Freighter');
    expect(ERRORS.WALLET_REJECTED).toContain('declined');
    expect(ERRORS.INVALID_ADDRESS).toContain('Stellar');
    expect(ERRORS.INVALID_AMOUNT).toContain('positive');
    expect(ERRORS.MEMO_TOO_LONG).toContain('28');
    expect(ERRORS.NETWORK_ERROR).toContain('Stellar');
    expect(ERRORS.SERVER_ERROR).toContain('server');
    expect(ERRORS.RATE_LIMITED).toContain('many');
    expect(ERRORS.NOT_FOUND).toContain('not found');
    expect(ERRORS.BATCH_EMPTY).toContain('at least one');
  });
  it('dynamic error functions return strings', () => {
    expect(ERRORS.INSUFFICIENT_BALANCE('10', '20')).toContain('10');
    expect(ERRORS.INSUFFICIENT_BALANCE('10', '20')).toContain('20');
  });
});

describe('success-messages', () => {
  it('has all expected success keys', () => {
    expect(SUCCESS_MESSAGES.PAYMENT_SENT('10 XLM')).toContain('10 XLM');
    expect(SUCCESS_MESSAGES.BATCH_SENT(5)).toContain('5');
    expect(SUCCESS_MESSAGES.WALLET_CONNECTED).toContain('successfully');
    expect(SUCCESS_MESSAGES.CSV_EXPORTED).toContain('CSV');
    expect(SUCCESS_MESSAGES.SETTINGS_SAVED).toContain('saved');
  });
});

describe('page-titles', () => {
  it('has titles', () => { expect(PAGE_TITLES.HOME).toBe('Treasury Dashboard'); });
  it('has descriptions', () => { expect(PAGE_DESCRIPTIONS.HOME).toContain('Monitor'); });
});

describe('aria-labels', () => {
  it('has aria labels', () => {
    expect(ARIA.TOGGLE_MENU).toBe('Toggle menu');
    expect(ARIA.CLOSE_MENU).toBe('Close menu');
    expect(ARIA.CONNECT_WALLET).toBe('Connect wallet');
    expect(ARIA.LOADING).toBe('Loading');
    expect(ARIA.SUCCESS).toBe('Success');
  });
});

describe('storage-keys', () => {
  it('has storage keys', () => {
    expect(STORAGE_KEYS.THEME).toContain('theme');
    expect(STORAGE_KEYS.WALLET_SESSION).toContain('wallet');
  });
});

describe('route-paths', () => {
  it('has page routes', () => {
    expect(ROUTES.HOME).toBe('/');
    expect(ROUTES.SEND).toBe('/send');
    expect(ROUTES.PAYMENTS).toBe('/payments');
    expect(ROUTES.GOVERNANCE).toBe('/governance');
    expect(ROUTES.MULTISIG).toBe('/multisig');
  });
  it('has API routes', () => {
    expect(API_ROUTES.HEALTH).toBe('/api/health');
    expect(API_ROUTES.PAYMENTS).toBe('/api/payments');
    expect(API_ROUTES.BATCHES).toBe('/api/batches');
    expect(API_ROUTES.GOVERNANCE_PROPOSALS).toBe('/api/governance/proposals');
  });
});

describe('z-index', () => {
  it('has z-index layers in order', () => {
    expect(Z_INDEX.CONTENT).toBe(0);
    expect(Z_INDEX.TOAST).toBe(60);
    expect(Z_INDEX.MODAL).toBeGreaterThan(Z_INDEX.MODAL_BACKDROP);
  });
});

describe('retry-config', () => {
  it('has retry config', () => {
    expect(RETRY_CONFIG.maxAttempts).toBe(3);
    expect(RETRY_CONFIG.webhook.maxAttempts).toBe(3);
    expect(RETRY_CONFIG.contract.maxAttempts).toBe(30);
  });
});

describe('responsive', () => {
  it('has breakpoints', () => { expect(BREAKPOINTS.sm).toBe(640); });
  it('has media queries', () => {
    expect(MEDIA.isMobile).toContain('max-width');
    expect(MEDIA.isDesktop).toContain('min-width');
  });
});

describe('feature-flags', () => {
  it('has feature flags', () => {
    expect(typeof FEATURE_FLAGS.MULTI_ASSET).toBe('boolean');
    expect(typeof isFeatureEnabled('MULTI_ASSET')).toBe('boolean');
  });
});

describe('browser-check', () => {
  it('returns browser info', () => {
    const info = checkBrowserSupport();
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('isSupported');
    expect(info).toHaveProperty('missingFeatures');
  });
});

describe('notifications', () => {
  it('tracks permission state', () => {
    expect(typeof isPermissionRequested()).toBe('boolean');
  });
  it('sendNotification does not throw', () => {
    expect(() => sendNotification('Test', { body: 'test' })).not.toThrow();
  });
  it('NOTIFY templates are defined', () => {
    expect(NOTIFY.paymentSent).toBeDefined();
    expect(NOTIFY.paymentReceived).toBeDefined();
    expect(NOTIFY.batchComplete).toBeDefined();
  });
});

describe('network', () => {
  it('returns testnet status', () => {
    const s = getNetworkStatus('TESTNET');
    expect(s.label).toBe('Testnet');
    expect(s.dotClass).toBe('bg-green-500');
  });
  it('returns mainnet status', () => {
    const s = getNetworkStatus('PUBLIC');
    expect(s.label).toBe('Mainnet');
    expect(s.dotClass).toBe('bg-red-500');
  });
  it('isMainnet', () => {
    expect(isMainnet('PUBLIC')).toBe(true);
    expect(isMainnet('TESTNET')).toBe(false);
  });
});

describe('headers', () => {
  it('returns security headers', () => {
    const h = getSecurityHeaders();
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
  });
  it('returns CORS headers', () => {
    const h = getCorsHeaders();
    expect(h['Access-Control-Allow-Methods']).toContain('GET');
  });
});

describe('constants', () => {
  it('has APP constants', () => {
    expect(APP.NAME).toBe('OphirPay');
    expect(APP.VERSION).toBe('0.1.0');
  });
  it('has STELLAR constants', () => {
    expect(STELLAR.MAX_OPS_PER_TX).toBe(100);
    expect(STELLAR.XLM_STROOPS).toBe(10000000);
    expect(STELLAR.ADDRESS_PATTERN).toBeInstanceOf(RegExp);
  });
  it('has UI constants', () => {
    expect(UI.TOAST_DURATION).toBe(5000);
    expect(UI.SEARCH_DEBOUNCE).toBe(300);
  });
  it('has API constants', () => {
    expect(API.DEFAULT_PAGE_SIZE).toBe(20);
    expect(API.RATE_LIMIT_RPM).toBe(120);
  });
});

describe('string-builder', () => {
  it('builds tx summary', () => {
    const s = buildTxSummary({ payer: 'GABCD', payee: 'GWXYZ', amount: '100', asset: 'XLM' });
    expect(s).toContain('100');
    expect(s).toContain('XLM');
  });
  it('builds batch summary', () => {
    const s = buildBatchSummary({ totalPayments: 5, totalAmount: '500', asset: 'XLM' });
    expect(s).toContain('5');
    expect(s).toContain('500');
  });
  it('shortens address', () => {
    expect(shortenAddress('GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD')).toContain('...');
  });
  it('builds event messages', () => {
    expect(buildEventMessage('payment_sent', '100', 'GABCD')).toContain('Sent');
    expect(buildEventMessage('batch_completed', '500', 'GABCD')).toContain('Batch');
    expect(buildEventMessage('stream_created', '50', 'GABCD')).toContain('Stream');
    expect(buildEventMessage('unknown', '10', 'GABCD')).toContain('Event');
  });
});
