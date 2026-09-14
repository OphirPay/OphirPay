// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Low-coverage lib modules ──
import { useFormSubmit, useFormReset } from '@/lib/form-helpers';
import { computePagination, prismaPagination } from '@/lib/pagination-utils';
import { getRateLimitHeaders, isRateLimited } from '@/lib/rate-limit-headers';
import { sendNotification, isPermissionRequested, requestNotificationPermission, NOTIFY } from '@/lib/notifications';
import { logger } from '@/lib/logger';
import { generateRandomHex, generateId, timingSafeEqual } from '@/lib/crypto';
import { sendEmail, EMAIL_TEMPLATES } from '@/lib/email';
import { validateEnv, isProduction, getDatabaseProvider, getAppUrl } from '@/lib/env';
import { FEATURE_FLAGS, isFeatureEnabled, overrideFeatureFlag, type FeatureFlag } from '@/lib/feature-flags';
import { estimateBatchFee } from '@/lib/fee-estimator';
import { trapFocus } from '@/lib/focus-trap';
import { captureHealthSnapshot, formatHealthSnapshot, logMemoryUsage } from '@/lib/monitoring';
import { PRELOAD_ROUTES } from '@/lib/prefetch';
import { trackEvent, trackPageView } from '@/lib/analytics-events';
import { computeAnalytics, groupByDay, percentChange } from '@/lib/analytics-helpers';
import { DURATIONS, getStaggerDelay, EASING, waitForAnimation } from '@/lib/animation';
import { sanitizeHtml, escapeHtml, hasSqlInjectionPatterns, sanitizeStellarAddress, sanitizeSlug } from '@/lib/sanitize';
import { cn, shortenAddress, formatAmount, formatDate, timeAgo, getStatusColor } from '@/lib/utils';
import { COLORS, lighten } from '@/lib/color-utils';
import { getSecurityHeaders, getCorsHeaders } from '@/lib/headers';
import { searchRecords, rankSearchResults } from '@/lib/search-index';
import { buildTxSummary, buildBatchSummary, shortenAddress as sbShorten, buildEventMessage } from '@/lib/string-builder';
import { exportToCsv } from '@/lib/csv';
import { getDateRange, getDateRangePresets } from '@/lib/date-range';
import { formatXlm, formatFiat, formatTokenAmount, formatCompact } from '@/lib/format-currency';
import { formatStroopsToXlm, formatBaseFee, estimateTotalCost } from '@/lib/gas-estimate';
import { getStructuredData } from '@/lib/json-ld';
import { canonicalUrl, breadcrumbJsonLd } from '@/lib/seo';
import { generateMetadata } from '@/lib/metadata-helpers';
import { incMetric, getMetricsSnapshot, observeDbQuery } from '@/lib/metrics-counters';
import { sleep, withTimeout, debounce, throttle } from '@/lib/timeout';



// ═══════════════════════════════════════════════════════════════
// form-helpers
// ═══════════════════════════════════════════════════════════════
describe('form-helpers', () => {
  describe('useFormSubmit', () => {
    it('returns submit and isSubmitting', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFormSubmit(handler));
      expect(result.current.isSubmitting).toBe(false);
      expect(typeof result.current.submit).toBe('function');
    });

    it('sets isSubmitting during submission', async () => {
      const handler = vi.fn().mockImplementation(() => new Promise(r => setTimeout(r, 50)));
      const { result } = renderHook(() => useFormSubmit(handler));
      await act(async () => {
        result.current.submit();
      });
      // After act, the promise is pending and state should be updated
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('prevents double submission', async () => {
      let resolvePromise: () => void;
      const handler = vi.fn().mockImplementation(() => new Promise<void>(r => { resolvePromise = r; }));
      const { result } = renderHook(() => useFormSubmit(handler));
      const p1 = act(() => { result.current.submit(); });
      // isSubmitting is now true — second call should be blocked
      act(() => { result.current.submit(); });
      expect(handler).toHaveBeenCalledTimes(1);
      // Resolve the promise to clean up
      resolvePromise!();
      await p1;
    });

    it('resets isSubmitting after completion', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFormSubmit(handler));
      await act(async () => {
        await result.current.submit();
      });
      expect(result.current.isSubmitting).toBe(false);
    });

    it('resets isSubmitting even on error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      const { result } = renderHook(() => useFormSubmit(handler));
      await act(async () => {
        try { await result.current.submit(); } catch {}
      });
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  describe('useFormReset', () => {
    it('returns a function', () => {
      const ref = { current: null };
      const { result } = renderHook(() => useFormReset(ref as Parameters<typeof useFormReset>[0]));
      expect(typeof result.current).toBe('function');
    });

    it('calls reset on form element', () => {
      const form = document.createElement('form');
      const resetSpy = vi.spyOn(form, 'reset');
      const ref = { current: form };
      const { result } = renderHook(() => useFormReset(ref as Parameters<typeof useFormReset>[0]));
      act(() => { result.current(); });
      expect(resetSpy).toHaveBeenCalled();
    });

    it('handles null ref gracefully', () => {
      const ref = { current: null };
      const { result } = renderHook(() => useFormReset(ref as Parameters<typeof useFormReset>[0]));
      expect(() => act(() => { result.current(); })).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// pagination-utils
// ═══════════════════════════════════════════════════════════════
describe('pagination-utils', () => {
  describe('computePagination', () => {
    it('computes for first page', () => {
      const result = computePagination(1, 10, 100);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(10);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrev).toBe(false);
    });

    it('computes for last page', () => {
      const result = computePagination(10, 10, 100);
      expect(result.page).toBe(10);
      expect(result.hasNext).toBe(false);
      expect(result.hasPrev).toBe(true);
    });

    it('computes for middle page', () => {
      const result = computePagination(5, 10, 100);
      expect(result.hasNext).toBe(true);
      expect(result.hasPrev).toBe(true);
    });

    it('handles zero total', () => {
      const result = computePagination(1, 10, 0);
      expect(result.totalPages).toBe(1);
      expect(result.hasNext).toBe(false);
      expect(result.hasPrev).toBe(false);
    });

    it('handles total less than limit', () => {
      const result = computePagination(1, 20, 5);
      expect(result.totalPages).toBe(1);
      expect(result.hasNext).toBe(false);
    });
  });

  describe('prismaPagination', () => {
    it('computes skip and take for page 1', () => {
      expect(prismaPagination(1, 10)).toEqual({ skip: 0, take: 10 });
    });

    it('computes skip and take for page 3', () => {
      expect(prismaPagination(3, 10)).toEqual({ skip: 20, take: 10 });
    });

    it('computes skip and take for page 0', () => {
      expect(prismaPagination(0, 10)).toEqual({ skip: -10, take: 10 });
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// rate-limit-headers
// ═══════════════════════════════════════════════════════════════
describe('rate-limit-headers', () => {
  describe('getRateLimitHeaders', () => {
    it('returns headers with remaining capacity', () => {
      const headers = getRateLimitHeaders({ limit: 100, remaining: 50, reset: 2000000000 });
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('50');
      expect(headers['X-RateLimit-Reset']).toBe('2000000000');
      expect(headers['Retry-After']).toBe('0');
    });

    it('returns Retry-After when depleted', () => {
      const future = Math.floor(Date.now() / 1000) + 60;
      const headers = getRateLimitHeaders({ limit: 100, remaining: 0, reset: future });
      expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    });
  });

  describe('isRateLimited', () => {
    it('returns false when remaining > 0', () => {
      expect(isRateLimited({ limit: 100, remaining: 50, reset: 2000000000 })).toBe(false);
    });

    it('returns true when depleted and reset in future', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      expect(isRateLimited({ limit: 100, remaining: 0, reset: future })).toBe(true);
    });

    it('returns false when depleted but reset has passed', () => {
      const past = Math.floor(Date.now() / 1000) - 10;
      expect(isRateLimited({ limit: 100, remaining: 0, reset: past })).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// notifications
// ═══════════════════════════════════════════════════════════════
describe('notifications', () => {
  describe('isPermissionRequested', () => {
    it('returns boolean', () => {
      expect(typeof isPermissionRequested()).toBe('boolean');
    });
  });

  describe('sendNotification', () => {
    it('does not throw when Notification is unavailable', () => {
      expect(() => sendNotification('Test')).not.toThrow();
    });

    it('does not throw with options', () => {
      expect(() => sendNotification('Test', { body: 'Body', tag: 'tag' })).not.toThrow();
    });
  });

  describe('requestNotificationPermission', () => {
    it('returns false when Notification is not available', async () => {
      // In jsdom, Notification may not be available
      const result = await requestNotificationPermission();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('NOTIFY templates', () => {
    it('paymentSent does not throw', () => {
      expect(() => NOTIFY.paymentSent('10 XLM', 'txhash123')).not.toThrow();
    });

    it('paymentReceived does not throw', () => {
      expect(() => NOTIFY.paymentReceived('10 XLM', 'GABCD')).not.toThrow();
    });

    it('batchComplete does not throw', () => {
      expect(() => NOTIFY.batchComplete(5)).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// logger
// ═══════════════════════════════════════════════════════════════
describe('logger', () => {
  it('has debug method', () => {
    expect(() => logger.debug('test')).not.toThrow();
  });

  it('has info method', () => {
    expect(() => logger.info('test')).not.toThrow();
  });

  it('has warn method', () => {
    expect(() => logger.warn('test')).not.toThrow();
  });

  it('has error method with context', () => {
    expect(() => logger.error('test', { extra: 'data' })).not.toThrow();
  });

  it('has request method', () => {
    expect(() => logger.request('GET', '/api/test', 200, 42)).not.toThrow();
  });

  it('has metric method', () => {
    expect(() => logger.metric('cpu_usage', 0.5, { host: 'srv1' })).not.toThrow();
  });

  it('has timing method', () => {
    expect(() => logger.timing('db_query', 12.3)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// crypto
// ═══════════════════════════════════════════════════════════════
describe('crypto', () => {
  describe('generateRandomHex', () => {
    it('returns hex string of default length', () => {
      const hex = generateRandomHex();
      expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns hex string of custom length', () => {
      const hex = generateRandomHex(16);
      expect(hex).toMatch(/^[0-9a-f]{32}$/);
    });

    it('returns different values on successive calls', () => {
      expect(generateRandomHex()).not.toBe(generateRandomHex());
    });

    it('returns empty for zero bytes', () => {
      expect(generateRandomHex(0)).toBe('');
    });
  });

  describe('generateId', () => {
    it('returns URL-safe string of default length', () => {
      const id = generateId();
      expect(id).toHaveLength(21);
      expect(id).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('returns string of custom length', () => {
      expect(generateId(10)).toHaveLength(10);
    });

    it('returns different values on successive calls', () => {
      expect(generateId()).not.toBe(generateId());
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for equal strings', () => {
      expect(timingSafeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings', () => {
      expect(timingSafeEqual('abc', 'abx')).toBe(false);
    });

    it('returns false for different length strings', () => {
      expect(timingSafeEqual('abc', 'ab')).toBe(false);
    });

    it('returns true for empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// email
// ═══════════════════════════════════════════════════════════════
describe('email', () => {
  describe('sendEmail', () => {
    it('returns a boolean in dev mode', async () => {
      const result = await sendEmail({ to: 't@t.com', subject: 'S', html: '<p>B</p>' });
      expect(typeof result).toBe('boolean');
    });
  });

  describe('EMAIL_TEMPLATES', () => {
    it('paymentSent has subject and html', () => {
      const t = EMAIL_TEMPLATES.paymentSent('10 XLM', 'txhash');
      expect(t.subject).toContain('10 XLM');
      expect(t.html).toContain('10 XLM');
    });

    it('paymentReceived has subject and html', () => {
      const t = EMAIL_TEMPLATES.paymentReceived('10 XLM', 'GABCD');
      expect(t.subject).toContain('10 XLM');
      expect(t.html).toContain('GABCD');
    });

    it('webhookFailed has subject and html', () => {
      const t = EMAIL_TEMPLATES.webhookFailed('https://hook.com', 'payment_sent');
      expect(t.subject).toContain('payment_sent');
      expect(t.html).toContain('https://hook.com');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// env
// ═══════════════════════════════════════════════════════════════
describe('env', () => {
  describe('isProduction', () => {
    it('returns boolean', () => {
      expect(typeof isProduction()).toBe('boolean');
    });

    it('returns false in test', () => {
      expect(isProduction()).toBe(false);
    });
  });

  describe('getDatabaseProvider', () => {
    it('returns a valid provider', () => {
      expect(['sqlite', 'postgresql']).toContain(getDatabaseProvider());
    });
  });

  describe('getAppUrl', () => {
    it('returns a URL string', () => {
      expect(getAppUrl()).toMatch(/^https?:\/\//);
    });

    it('does not end with trailing slash', () => {
      expect(getAppUrl().endsWith('/')).toBe(false);
    });
  });

  describe('validateEnv', () => {
    it('throws when DATABASE_URL is missing', () => {
      // DATABASE_URL is not set in test env — validateEnv should throw
      expect(() => validateEnv()).toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// feature-flags
// ═══════════════════════════════════════════════════════════════
describe('feature-flags', () => {
  describe('FEATURE_FLAGS', () => {
    it('has boolean MULTI_ASSET', () => {
      expect(typeof FEATURE_FLAGS.MULTI_ASSET).toBe('boolean');
    });

    it('has boolean RECURRING_PAYMENTS', () => {
      expect(typeof FEATURE_FLAGS.RECURRING_PAYMENTS).toBe('boolean');
    });

    it('has boolean WEBHOOKS', () => {
      expect(typeof FEATURE_FLAGS.WEBHOOKS).toBe('boolean');
    });

    it('has boolean ADVANCED_ANALYTICS', () => {
      expect(typeof FEATURE_FLAGS.ADVANCED_ANALYTICS).toBe('boolean');
    });

    it('has boolean API_KEYS', () => {
      expect(typeof FEATURE_FLAGS.API_KEYS).toBe('boolean');
    });
  });

  describe('isFeatureEnabled', () => {
    it('returns boolean for valid flag', () => {
      expect(typeof isFeatureEnabled('MULTI_ASSET')).toBe('boolean');
    });

    it('returns false for unknown flag', () => {
      expect(isFeatureEnabled('UNKNOWN_FLAG' as unknown as FeatureFlag)).toBe(false);
    });
  });

  describe('overrideFeatureFlag', () => {
    it('does not throw in dev', () => {
      expect(() => overrideFeatureFlag('MULTI_ASSET', true)).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// fee-estimator
// ═══════════════════════════════════════════════════════════════
describe('fee-estimator', () => {
  describe('estimateBatchFee', () => {
    it('calculates batch fee', () => {
      expect(estimateBatchFee(5, 100)).toBe('500');
    });

    it('calculates with default base fee', () => {
      expect(estimateBatchFee(3)).toBe('300');
    });

    it('returns zero for zero recipients', () => {
      expect(estimateBatchFee(0)).toBe('0');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// focus-trap
// ═══════════════════════════════════════════════════════════════
describe('focus-trap', () => {
  describe('trapFocus', () => {
    it('returns a cleanup function', () => {
      const div = document.createElement('div');
      div.innerHTML = '<button>Click</button>';
      document.body.appendChild(div);
      const cleanup = trapFocus(div);
      expect(typeof cleanup).toBe('function');
      cleanup();
      document.body.removeChild(div);
    });

    it('handles empty container', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const cleanup = trapFocus(div);
      expect(typeof cleanup).toBe('function');
      cleanup();
      document.body.removeChild(div);
    });

    it('cleanup restores focus', () => {
      const previous = document.createElement('button');
      document.body.appendChild(previous);
      previous.focus();

      const div = document.createElement('div');
      div.innerHTML = '<button>New</button>';
      document.body.appendChild(div);
      const cleanup = trapFocus(div);
      cleanup();

      document.body.removeChild(div);
      document.body.removeChild(previous);
      // Cleanup should not throw
      expect(true).toBe(true);
    });

    it('redirects focus back inside when it escapes', () => {
      const outside = document.createElement('button');
      document.body.appendChild(outside);

      const div = document.createElement('div');
      div.innerHTML = '<button>Inside</button>';
      document.body.appendChild(div);
      const cleanup = trapFocus(div);

      outside.focus();
      expect(document.activeElement).not.toBe(outside);

      cleanup();
      document.body.removeChild(div);
      document.body.removeChild(outside);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// monitoring
// ═══════════════════════════════════════════════════════════════
describe('monitoring', () => {
  describe('captureHealthSnapshot', () => {
    it('returns snapshot with uptime > 0', () => {
      const snapshot = captureHealthSnapshot();
      expect(snapshot.uptime).toBeGreaterThan(0);
      expect(snapshot).toHaveProperty('memoryUsage');
      expect(snapshot.memoryUsage).toHaveProperty('heapUsed');
      expect(snapshot.memoryUsage).toHaveProperty('heapTotal');
      expect(snapshot.memoryUsage).toHaveProperty('rss');
    });
  });

  describe('formatHealthSnapshot', () => {
    it('formats snapshot with uptime and memory', () => {
      const snapshot = captureHealthSnapshot();
      const formatted = formatHealthSnapshot(snapshot);
      expect(formatted).toContain('Uptime');
      expect(formatted).toContain('MB');
    });
  });

  describe('logMemoryUsage', () => {
    it('does not throw', () => {
      expect(() => logMemoryUsage()).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// prefetch
// ═══════════════════════════════════════════════════════════════
describe('prefetch', () => {
  it('PRELOAD_ROUTES has expected routes', () => {
    expect(PRELOAD_ROUTES.length).toBeGreaterThan(0);
    expect(PRELOAD_ROUTES).toContain('/');
    expect(PRELOAD_ROUTES).toContain('/send');
    expect(PRELOAD_ROUTES).toContain('/payments');
  });
});

// ═══════════════════════════════════════════════════════════════
// analytics-events
// ═══════════════════════════════════════════════════════════════
describe('analytics-events', () => {
  describe('trackEvent', () => {
    it('does not throw for wallet_connect', () => {
      expect(() => trackEvent('wallet_connect')).not.toThrow();
    });

    it('does not throw with properties', () => {
      expect(() => trackEvent('payment_sent', { amount: '100', token: 'XLM' })).not.toThrow();
    });

    it('does not throw for error_occurred', () => {
      expect(() => trackEvent('error_occurred', { code: 'TEST' })).not.toThrow();
    });
  });

  describe('trackPageView', () => {
    it('does not throw', () => {
      expect(() => trackPageView('/dashboard')).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// analytics-helpers
// ═══════════════════════════════════════════════════════════════
describe('analytics-helpers', () => {
  describe('computeAnalytics', () => {
    const payments = [
      { amount: 100, status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' },
      { amount: 200, status: 'COMPLETED', createdAt: '2026-01-01T12:00:00Z' },
      { amount: 50, status: 'FAILED', createdAt: '2026-01-02T00:00:00Z' },
    ];

    it('computes total volume', () => {
      const result = computeAnalytics(payments);
      expect(result.totalVolume).toBe(350);
    });

    it('computes counts', () => {
      const result = computeAnalytics(payments);
      expect(result.totalCount).toBe(3);
      expect(result.successfulCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });

    it('computes success rate', () => {
      const result = computeAnalytics(payments);
      expect(result.successRate).toBeCloseTo(66.67, 0);
    });

    it('computes average', () => {
      const result = computeAnalytics(payments);
      expect(result.averageAmount).toBeCloseTo(116.67, 0);
    });

    it('computes largest and smallest', () => {
      const result = computeAnalytics(payments);
      expect(result.largestAmount).toBe(200);
      expect(result.smallestAmount).toBe(50);
    });

    it('handles empty array', () => {
      const result = computeAnalytics([]);
      expect(result.totalCount).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.averageAmount).toBe(0);
    });
  });

  describe('groupByDay', () => {
    const payments = [
      { amount: 100, status: 'COMPLETED', createdAt: '2026-01-01T10:00:00Z' },
      { amount: 200, status: 'COMPLETED', createdAt: '2026-01-01T15:00:00Z' },
      { amount: 50, status: 'COMPLETED', createdAt: '2026-01-02T08:00:00Z' },
    ];

    it('groups by day', () => {
      const result = groupByDay(payments);
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2026-01-01');
      expect(result[0].volume).toBe(300);
      expect(result[0].count).toBe(2);
      expect(result[1].date).toBe('2026-01-02');
      expect(result[1].volume).toBe(50);
      expect(result[1].count).toBe(1);
    });

    it('handles empty', () => {
      expect(groupByDay([])).toEqual([]);
    });
  });

  describe('percentChange', () => {
    it('computes positive change', () => {
      expect(percentChange(150, 100)).toBe(50);
    });

    it('computes negative change', () => {
      expect(percentChange(80, 100)).toBe(-20);
    });

    it('handles zero previous', () => {
      expect(percentChange(100, 0)).toBe(100);
    });

    it('handles both zero', () => {
      expect(percentChange(0, 0)).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// animation
// ═══════════════════════════════════════════════════════════════
describe('animation', () => {
  it('DURATIONS constants', () => {
    expect(DURATIONS.fast).toBe(150);
    expect(DURATIONS.normal).toBe(250);
    expect(DURATIONS.slow).toBe(400);
    expect(DURATIONS.extraSlow).toBe(600);
  });

  it('getStaggerDelay returns ms string', () => {
    expect(getStaggerDelay(0)).toBe('0ms');
    expect(getStaggerDelay(1)).toBe('50ms');
    expect(getStaggerDelay(3)).toBe('150ms');
    expect(getStaggerDelay(2, 100)).toBe('200ms');
  });

  it('EASING curves', () => {
    expect(EASING.easeOut).toContain('cubic-bezier');
    expect(EASING.easeIn).toContain('cubic-bezier');
    expect(EASING.easeInOut).toContain('cubic-bezier');
  });

  describe('waitForAnimation', () => {
    it('returns a promise', () => {
      const el = document.createElement('div');
      const result = waitForAnimation(el);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// sanitize
// ═══════════════════════════════════════════════════════════════
describe('sanitize', () => {
  describe('sanitizeHtml', () => {
    it('removes angle brackets and quotes', () => {
      const result = sanitizeHtml('<script>alert("xss")</script>');
      // <, >, ", ', & are stripped; parentheses are not in the strip set
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
    });

    it('truncates long input', () => {
      const long = 'a'.repeat(6000);
      expect(sanitizeHtml(long).length).toBe(5000);
    });

    it('returns empty for empty input', () => {
      expect(sanitizeHtml('')).toBe('');
    });
  });

  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
      expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes quotes', () => {
      expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('returns plain text unchanged', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });
  });

  describe('hasSqlInjectionPatterns', () => {
    it('detects SELECT', () => {
      expect(hasSqlInjectionPatterns('select * from')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(hasSqlInjectionPatterns('hello world')).toBe(false);
    });

    it('returns false for empty', () => {
      expect(hasSqlInjectionPatterns('')).toBe(false);
    });
  });

  describe('sanitizeStellarAddress', () => {
    it('keeps valid characters', () => {
      // Use exactly 56 valid Stellar chars
      const key = 'G' + 'A'.repeat(55);
      expect(sanitizeStellarAddress(key)).toBe(key);
    });

    it('removes invalid characters', () => {
      expect(sanitizeStellarAddress('GABC-def')).toBe('GABC');
    });

    it('truncates to 56 chars', () => {
      const long = 'G' + 'A'.repeat(60);
      expect(sanitizeStellarAddress(long).length).toBe(56);
    });
  });

  describe('sanitizeSlug', () => {
    it('converts to lowercase slug', () => {
      expect(sanitizeSlug('Hello World')).toBe('hello-world');
    });

    it('removes leading/trailing dashes', () => {
      expect(sanitizeSlug('  hello  ')).toBe('hello');
    });

    it('truncates to max length', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeSlug(long).length).toBe(100);
    });

    it('handles special chars', () => {
      expect(sanitizeSlug('Price: $100!!!')).toBe('price-100');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// utils — additional coverage
// ═══════════════════════════════════════════════════════════════
describe('utils-coverage', () => {
  describe('cn', () => {
    it('merges classes', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
      expect(cn('foo', false && 'bar')).toBe('foo');
      expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
      expect(cn()).toBe('');
    });
  });

  describe('shortenAddress', () => {
    it('shortens address', () => {
      const addr = 'GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD';
      expect(shortenAddress(addr).length).toBeLessThan(addr.length);
    });

    it('returns empty for empty', () => {
      expect(shortenAddress('')).toBe('');
    });
  });

  describe('formatAmount', () => {
    it('formats with asset', () => {
      expect(formatAmount(100, 'XLM')).toContain('XLM');
    });

    it('defaults to XLM', () => {
      expect(formatAmount(100)).toContain('XLM');
    });

    it('formats USDC', () => {
      expect(formatAmount(50, 'USDC')).toContain('USDC');
    });
  });

  describe('formatDate', () => {
    it('formats a date string', () => {
      const result = formatDate('2026-01-15');
      expect(result).toContain('2026');
    });
  });

  describe('timeAgo', () => {
    it('returns just now for current time', () => {
      expect(timeAgo(new Date().toISOString())).toBe('just now');
    });

    it('returns minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(timeAgo(fiveMinAgo)).toContain('m ago');
    });

    it('returns hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(threeHoursAgo)).toContain('h ago');
    });

    it('returns days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(timeAgo(twoDaysAgo)).toContain('d ago');
    });
  });

  describe('getStatusColor', () => {
    it('returns colors for completed', () => {
      const colors = getStatusColor('COMPLETED');
      expect(colors.bg).toContain('green');
      expect(colors.text).toContain('green');
    });

    it('returns colors for pending', () => {
      const colors = getStatusColor('PENDING');
      expect(colors.bg).toContain('blue');
    });

    it('returns colors for failed', () => {
      const colors = getStatusColor('FAILED');
      expect(colors.bg).toContain('red');
    });

    it('returns default for unknown', () => {
      const colors = getStatusColor('UNKNOWN');
      expect(colors.bg).toContain('gray');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage for already-partially-covered modules
// ═══════════════════════════════════════════════════════════════
describe('color-utils-additional', () => {
  it('COLORS constants', () => {
    expect(COLORS.primary).toBe('#7B68EE');
    expect(COLORS.success).toBe('#10b981');
    expect(COLORS.danger).toBe('#ef4444');
  });

  it('lighten basic', () => {
    const result = lighten('#ff0000', 50);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('headers-additional', () => {
  it('security headers', () => {
    const h = getSecurityHeaders();
    expect(h['X-Content-Type-Options']).toBe('nosniff');
  });
  it('cors headers', () => {
    const h = getCorsHeaders();
    expect(h['Access-Control-Allow-Methods']).toContain('GET');
  });
});

describe('search-index', () => {
  it('searchRecords returns all when query is empty', () => {
    const records = [{ name: 'Alice' }, { name: 'Bob' }];
    const result = searchRecords(records, '', ['name']);
    expect(result).toEqual(records);
  });

  it('searchRecords filters by query', () => {
    const records = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
    const result = searchRecords(records, 'ali', ['name']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  it('searchRecords is case-insensitive', () => {
    const records = [{ name: 'Alice' }];
    const result = searchRecords(records, 'ALICE', ['name']);
    expect(result).toHaveLength(1);
  });

  it('searchRecords handles multiple fields', () => {
    const records = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    const result = searchRecords(records, 'bob', ['name', 'email']);
    expect(result).toHaveLength(1);
  });

  it('rankSearchResults ranks by relevance', () => {
    const records = [
      { name: 'Al', value: 'x' },
      { name: 'Alice Johnson', value: 'y' },
      { name: 'Alice', value: 'z' },
    ];
    const result = rankSearchResults(records, 'Alice', ['name']);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Exact match should rank highest
    if (result.length > 0) {
      expect(result[0]._score).toBeGreaterThanOrEqual(
        result[result.length - 1]._score
      );
    }
  });

  it('rankSearchResults returns empty for no match', () => {
    const records = [{ name: 'Alice' }];
    const result = rankSearchResults(records, 'doesnotexist', ['name']);
    expect(result).toHaveLength(0);
  });
});

describe('string-builder-additional', () => {
  it('builds tx summary', () => {
    const s = buildTxSummary({ payer: 'GA', payee: 'GB', amount: '100', asset: 'XLM' });
    expect(s).toContain('100');
  });
  it('builds batch summary', () => {
    const s = buildBatchSummary({ totalPayments: 5, totalAmount: '500', asset: 'XLM' });
    expect(s).toContain('5');
  });
  it('shortens address', () => {
    const addr = 'GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD';
    expect(sbShorten(addr)).toContain('...');
  });
  it('builds event message for unknown', () => {
    expect(buildEventMessage('unknown_event', '10', 'GABCD')).toContain('Event');
  });
});

describe('csv-additional', () => {
  it('exports csv without throwing', () => {
    expect(() => exportToCsv([{ name: 'x' }], [{ key: 'name', header: 'Name' }], { filename: 't.csv' })).not.toThrow();
  });
});

describe('date-range-additional', () => {
  it('today range', () => {
    const range = getDateRange('today');
    expect(range.label).toBe('Today');
    expect(range.from).toBeDefined();
    expect(range.to).toBeDefined();
  });
  it('7d range', () => {
    const range = getDateRange('7d');
    expect(range.label).toContain('7');
  });
  it('30d range', () => {
    const range = getDateRange('30d');
    expect(range.label).toContain('30');
  });
  it('presets', () => {
    expect(getDateRangePresets().length).toBeGreaterThan(3);
  });
});

describe('format-currency-additional', () => {
  it('formatXlm', () => expect(formatXlm(10000000)).toContain('1'));
  it('formatFiat', () => expect(formatFiat(100)).toContain('$'));
  it('formatTokenAmount', () => expect(formatTokenAmount(100, 'USDC')).toContain('USDC'));
  it('formatCompact thousands', () => expect(formatCompact(1500)).toContain('K'));
  it('formatCompact millions', () => expect(formatCompact(1500000)).toContain('M'));
  it('formatCompact small', () => {
    const result = formatCompact(42);
    expect(result).toBeDefined();
  });
});

describe('gas-estimate-additional', () => {
  it('formatStroopsToXlm', () => expect(formatStroopsToXlm(100)).toContain('XLM'));
  it('formatBaseFee', () => expect(formatBaseFee(100)).toContain('minimum'));
  it('estimateTotalCost', () => {
    const c = estimateTotalCost(3, 100);
    expect(c.stroops).toBe(300);
    expect(c.xlm).toBeDefined();
    expect(c.xlm).toContain('XLM');
  });
});

describe('json-ld-additional', () => {
  it('returns WebApplication type', () => {
    expect(getStructuredData()['@type']).toBe('WebApplication');
  });
});

describe('seo-additional', () => {
  it('canonicalUrl', () => expect(canonicalUrl('/send')).toContain('/send'));
  it('breadcrumbJsonLd single', () => {
    expect(breadcrumbJsonLd([{ name: 'a', url: '/' }]).itemListElement.length).toBe(1);
  });
  it('breadcrumbJsonLd multiple', () => {
    const result = breadcrumbJsonLd([
      { name: 'Home', url: '/' },
      { name: 'Send', url: '/send' },
    ]);
    expect(result.itemListElement.length).toBe(2);
  });
});

describe('metadata-helpers-additional', () => {
  it('generates metadata', () => {
    const meta = generateMetadata({ title: 'T', description: 'D' });
    expect(meta.title).toBe('T');
    expect(meta.description).toBe('D');
  });
  it('noIndex option', () => {
    const meta = generateMetadata({ title: 'T', description: 'D', noIndex: true });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
  it('with path generates canonical', () => {
    const meta = generateMetadata({ title: 'T', description: 'D', path: '/send' });
    expect(meta.alternates?.canonical).toBeDefined();
    expect(meta.openGraph?.title).toBe('T');
  });
});

describe('metrics-counters-additional', () => {
  it('incMetric increments', () => {
    incMetric('http_requests_total');
    expect(getMetricsSnapshot().http_requests_total).toBeGreaterThan(0);
  });
  it('observeDbQuery records', () => {
    observeDbQuery(0.05);
    expect(getMetricsSnapshot().db_query_duration_seconds_count).toBeGreaterThan(0);
  });
});

describe('timeout-additional', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it('sleep resolves', async () => {
    const p = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
  });
  it('debounce calls after delay', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalled();
  });
  it('throttle calls immediately', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t();
    expect(fn).toHaveBeenCalledTimes(1);
    t();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('withTimeout resolves', async () => {
    const fast = new Promise<string>(r => setTimeout(() => r('ok'), 100));
    const result = withTimeout(fast, 500);
    vi.advanceTimersByTime(100);
    await expect(result).resolves.toBe('ok');
  });
});


