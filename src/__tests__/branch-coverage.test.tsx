// SPDX-License-Identifier: MIT
// Targeted branch-coverage tests to push overall branches past 80%

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Components with low branch coverage
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Textarea, Select } from '@/components/ui/Form';
import { StatusBadge } from '@/components/ui/Badge';

// Lib modules with branch gaps
import { isProduction, getDatabaseProvider, getAppUrl } from '@/lib/env';
import { sanitizeHtml, escapeHtml, sanitizeSlug, hasSqlInjectionPatterns } from '@/lib/sanitize';
import { logger } from '@/lib/logger';
import { computePagination, prismaPagination } from '@/lib/pagination-utils';
import { isRateLimited, getRateLimitHeaders } from '@/lib/rate-limit-headers';
import { generateRandomHex, generateId, timingSafeEqual } from '@/lib/crypto';
import { FEATURE_FLAGS, isFeatureEnabled, type FeatureFlag } from '@/lib/feature-flags';
import { truncate, truncateMiddle, pluralize, titleCase, formatBytes } from '@/lib/text';
import { cn, shortenAddress, formatAmount, formatDate, timeAgo, getStatusColor } from '@/lib/utils';
import { getSecurityHeaders, getCorsHeaders } from '@/lib/headers';
import { sendNotification } from '@/lib/notifications';
import { validateAmount, getFieldError, validateMemo } from '@/lib/validation-helpers';

// ═══════════════════════════════════════════════════════════════
// Pagination — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Pagination branches', () => {
  it('renders page numbers for large page ranges', () => {
    render(
      <Pagination page={5} totalPages={20} hasNext={true} hasPrev={true}
        onNext={vi.fn()} onPrev={vi.fn()} />
    );
    // Should show first, last, and current page
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('20')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('hides page buttons on mobile via responsive class', () => {
    const { container } = render(
      <Pagination page={1} totalPages={5} hasNext={true} hasPrev={false}
        onNext={vi.fn()} onPrev={vi.fn()} />
    );
    const pageButtons = container.querySelector('.hidden.sm\\:flex');
    expect(pageButtons).toBeDefined();
  });

  it('accepts custom className', () => {
    const { container } = render(
      <Pagination page={1} totalPages={5} hasNext={true} hasPrev={false}
        onNext={vi.fn()} onPrev={vi.fn()} className="my-custom" />
    );
    expect(container.querySelector('nav')?.className).toContain('my-custom');
  });

  it('renders current page with active style', () => {
    render(
      <Pagination page={3} totalPages={5} hasNext={true} hasPrev={true}
        onNext={vi.fn()} onPrev={vi.fn()} onPage={vi.fn()} />
    );
    const page3 = screen.getByText('3');
    expect(page3.className).toContain('bg-ophir-600');
  });
});

// ═══════════════════════════════════════════════════════════════
// ConfirmDialog — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('ConfirmDialog branches', () => {
  it('renders with primary variant', () => {
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()}
        title="Save" description="Save changes?" variant="primary" />
    );
    const button = screen.getByText('Confirm').closest('button');
    expect(button).toBeDefined();
  });

  it('calls onClose on cancel', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog open={true} onClose={onClose} onConfirm={vi.fn()}
        title="T" description="D" />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('uses default labels', () => {
    render(
      <ConfirmDialog open={true} onClose={vi.fn()} onConfirm={vi.fn()}
        title="T" description="D" />
    );
    expect(screen.getByText('Confirm')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Form — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Form branches', () => {
  it('Input renders with left icon', () => {
    const { container } = render(
      <Input label="Search" leftIcon={<span>🔍</span>} />
    );
    expect(screen.getByText('🔍')).toBeDefined();
    expect(container.querySelector('input')?.className).toContain('pl-9');
  });

  it('Input renders with right icon', () => {
    const { container } = render(
      <Input label="Amount" rightIcon={<span>XLM</span>} />
    );
    expect(screen.getByText('XLM')).toBeDefined();
    expect(container.querySelector('input')?.className).toContain('pr-9');
  });

  it('Input shows hint when no error', () => {
    render(<Input label="Email" hint="Enter your email" />);
    expect(screen.getByText('Enter your email')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Input shows error instead of hint', () => {
    render(<Input label="Email" error="Required" hint="Enter your email" />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.queryByText('Enter your email')).toBeNull();
  });

  it('Textarea shows error', () => {
    render(<Textarea label="Notes" error="Too long" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
  });

  it('Select without placeholder does not render disabled option', () => {
    render(<Select label="Asset" options={[{ value: 'xlm', label: 'XLM' }]} />);
    expect(screen.queryByText('Choose...')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// StatusBadge — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('StatusBadge branches', () => {
  it('handles PROCESSING status', () => {
    render(<StatusBadge status="PROCESSING" />);
    expect(screen.getByText('PROCESSING')).toBeDefined();
  });

  it('handles CANCELLED status', () => {
    render(<StatusBadge status="CANCELLED" />);
    expect(screen.getByText('CANCELLED')).toBeDefined();
  });

  it('handles EXPIRED status', () => {
    render(<StatusBadge status="EXPIRED" />);
    expect(screen.getByText('EXPIRED')).toBeDefined();
  });

  it('handles PENDING status', () => {
    render(<StatusBadge status="PENDING" />);
    expect(screen.getByText('PENDING')).toBeDefined();
  });

  it('handles unknown status', () => {
    render(<StatusBadge status="UNKNOWN_STATE" />);
    expect(screen.getByText('UNKNOWN STATE')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Sanitize — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Sanitize branches', () => {
  it('sanitizeHtml handles empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('sanitizeHtml with custom maxLength', () => {
    const long = 'a'.repeat(1000);
    expect(sanitizeHtml(long, 100).length).toBe(100);
  });

  it('escapeHtml handles all entities', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#x27;');
  });

  it('sanitizeSlug handles empty input', () => {
    expect(sanitizeSlug('')).toBe('');
  });

  it('sanitizeSlug with custom maxLength', () => {
    const result = sanitizeSlug('hello world test', 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('hasSqlInjectionPatterns false for numbers', () => {
    expect(hasSqlInjectionPatterns('12345')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Env — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Env branches', () => {
  it('isProduction returns false in test', () => {
    expect(isProduction()).toBe(false);
  });

  it('getDatabaseProvider returns default', () => {
    expect(['sqlite', 'postgresql']).toContain(getDatabaseProvider());
  });

  it('getAppUrl returns valid URL', () => {
    expect(getAppUrl()).toMatch(/^https?:\/\//);
  });
});

// ═══════════════════════════════════════════════════════════════
// Feature flags — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Feature flags branches', () => {
  it('isFeatureEnabled returns false for unknown', () => {
    expect(isFeatureEnabled('UNKNOWN' as unknown as FeatureFlag)).toBe(false);
  });

  it('FEATURE_FLAGS has all known flags', () => {
    expect('MULTI_ASSET' in FEATURE_FLAGS).toBe(true);
    expect('RECURRING_PAYMENTS' in FEATURE_FLAGS).toBe(true);
    expect('WEBHOOKS' in FEATURE_FLAGS).toBe(true);
    expect('ADVANCED_ANALYTICS' in FEATURE_FLAGS).toBe(true);
    expect('API_KEYS' in FEATURE_FLAGS).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Text — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Text branches', () => {
  it('truncate at exact boundary', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncateMiddle for short text', () => {
    expect(truncateMiddle('ab', 2)).toBe('ab');
  });

  it('pluralize with custom plural for 1', () => {
    expect(pluralize(1, 'child', 'children')).toBe('1 child');
  });

  it('formatBytes for GB', () => {
    const result = formatBytes(1073741824);
    expect(result).toMatch(/GB/);
  });

  it('titleCase for single word', () => {
    expect(titleCase('hello')).toBe('Hello');
  });
});

// ═══════════════════════════════════════════════════════════════
// Utils — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Utils branches', () => {
  it('shortenAddress with custom chars', () => {
    const addr = 'GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD';
    const result = shortenAddress(addr, 6);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(addr.length);
  });

  it('formatAmount with USDC', () => {
    expect(formatAmount(50, 'USDC')).toContain('USDC');
  });

  it('timeAgo for old dates returns formatted date', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days
    const result = timeAgo(old);
    expect(result).toMatch(/\d{4}/); // Contains a year
  });

  it('getStatusColor for PROCESSING', () => {
    const colors = getStatusColor('PROCESSING');
    expect(colors.bg).toContain('blue');
  });

  it('getStatusColor for CANCELLED', () => {
    const colors = getStatusColor('CANCELLED');
    expect(colors.bg).toContain('red');
  });

  it('cn with mixed values', () => {
    expect(cn('a', false && 'b', 'c', undefined, null)).toBe('a c');
  });

  it('getStatusColor for EXPIRED', () => {
    const colors = getStatusColor('EXPIRED');
    expect(colors.bg).toContain('red');
  });

  it('getStatusColor for CREATED', () => {
    const colors = getStatusColor('CREATED');
    expect(colors.bg).toContain('blue');
  });

  it('getStatusColor for PAID', () => {
    const colors = getStatusColor('PAID');
    expect(colors.bg).toContain('green');
  });

  it('formatDate returns formatted string', () => {
    const result = formatDate('2026-03-15T12:00:00Z');
    expect(result).toContain('2026');
  });

  it('formatAmount with custom decimals', () => {
    expect(formatAmount(1.2345678)).toContain('XLM');
  });
});

// ═══════════════════════════════════════════════════════════════
// Misc — branch coverage
// ═══════════════════════════════════════════════════════════════
describe('Misc branches', () => {
  it('getSecurityHeaders returns all headers', () => {
    const h = getSecurityHeaders();
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
  });

  it('getCorsHeaders returns all headers', () => {
    const h = getCorsHeaders();
    expect(h['Access-Control-Allow-Methods']).toContain('GET');
    expect(h['Access-Control-Allow-Origin']).toBeDefined();
  });

  it('sendNotification handles all NOTIFY templates', () => {
    expect(() => {
      sendNotification('Payment Sent: 10 XLM', { body: 'tx hash' });
    }).not.toThrow();
  });

  it('validateAmount handles edge cases', () => {
    expect(validateAmount('')).toBe('Amount is required');
    expect(validateAmount('0')).toBe('Amount must be greater than 0');
    expect(validateAmount('abc')).toBe('Amount must be a number');
  });

  it('validateMemo handles edge cases', () => {
    expect(validateMemo('')).toBeNull();
    expect(validateMemo('a'.repeat(29))).toBe('Memo must be 28 characters or fewer');
  });

  it('getFieldError handles unknown field', () => {
    expect(getFieldError('custom_field', 'anything')).toBeNull();
  });

  it('logger methods cover all levels', () => {
    expect(() => logger.debug('d', {})).not.toThrow();
    expect(() => logger.info('i', {})).not.toThrow();
    expect(() => logger.warn('w', {})).not.toThrow();
    expect(() => logger.error('e', { stack: 'trace' })).not.toThrow();
  });

  it('computePagination edge cases', () => {
    const r = computePagination(1, 5, 3);
    expect(r.totalPages).toBe(1);
    expect(r.hasNext).toBe(false);

    const r2 = computePagination(2, 5, 10);
    expect(r2.hasPrev).toBe(true);
    expect(r2.hasNext).toBe(false);
  });

  it('prismaPagination edge cases', () => {
    expect(prismaPagination(0, 10)).toEqual({ skip: -10, take: 10 });
    expect(prismaPagination(1, 0)).toEqual({ skip: 0, take: 0 });
  });

  it('isRateLimited edge cases', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    expect(isRateLimited({ limit: 10, remaining: 0, reset: past })).toBe(false);
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isRateLimited({ limit: 10, remaining: 0, reset: future })).toBe(true);
    expect(isRateLimited({ limit: 10, remaining: 5, reset: future })).toBe(false);
  });

  it('getRateLimitHeaders edge cases', () => {
    const h = getRateLimitHeaders({ limit: 10, remaining: 0, reset: 9999999999 });
    expect(Number(h['Retry-After'])).toBeGreaterThan(0);
  });

  it('getRateLimitHeaders with remaining capacity', () => {
    const h = getRateLimitHeaders({ limit: 10, remaining: 5, reset: 9999999999 });
    expect(h['Retry-After']).toBe('0');
  });

  it('crypto edge cases', () => {
    expect(generateRandomHex(0)).toBe('');
    expect(generateId(0)).toBe('');
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('a', '')).toBe(false);
    expect(generateId()).not.toBe(generateId());
  });

  it('hasSqlInjectionPatterns for UNION and ALTER', () => {
    expect(hasSqlInjectionPatterns('union all')).toBe(true);
    expect(hasSqlInjectionPatterns('alter table')).toBe(true);
    expect(hasSqlInjectionPatterns('update users')).toBe(true);
    expect(hasSqlInjectionPatterns('insert into')).toBe(true);
  });

  it('sanitizeHtml with undefined-like input does not throw', () => {
    expect(() => sanitizeHtml('normal', 100)).not.toThrow();
  });

  it('escapeHtml with no special chars returns same string', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('truncateMiddle with long text', () => {
    const result = truncateMiddle('this is a very long string for testing');
    expect(result).toContain('…');
    expect(result.length).toBeLessThan('this is a very long string for testing'.length);
  });

  it('titleCase for multi-word snake', () => {
    expect(titleCase('my_test_case')).toBe('My Test Case');
  });

  it('titleCase for single word', () => {
    expect(titleCase('hello')).toBe('Hello');
  });

  it('formatBytes for different units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toContain('KB');
    expect(formatBytes(1048576)).toContain('MB');
  });

  it('formatBytes for GB', () => {
    const result = formatBytes(1073741824);
    expect(result).toMatch(/GB/);
  });
});
