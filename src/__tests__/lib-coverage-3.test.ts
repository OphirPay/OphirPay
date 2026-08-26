// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';

import { truncate, truncateMiddle, pluralize, titleCase, formatBytes } from '@/lib/text';
import { DURATIONS, getStaggerDelay, EASING } from '@/lib/animation';
import { COLORS, CHART_COLORS, lighten } from '@/lib/color-utils';
import { cn, shortenAddress, getStatusColor } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════
// text
// ═══════════════════════════════════════════════════════════

describe('text', () => {
  describe('truncate', () => {
    it('returns short text unchanged', () => {
      expect(truncate('hello')).toBe('hello');
    });
    it('truncates long text', () => {
      expect(truncate('hello world this is long', 10)).toBe('hello wor…');
    });
    it('handles empty string', () => {
      expect(truncate('')).toBe('');
    });
  });

  describe('truncateMiddle', () => {
    it('truncates from middle', () => {
      const result = truncateMiddle('GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD');
      expect(result).toContain('…');
    });
    it('returns short text unchanged', () => {
      expect(truncateMiddle('short')).toBe('short');
    });
  });

  describe('pluralize', () => {
    it('returns singular for 1', () => {
      expect(pluralize(1, 'apple')).toBe('1 apple');
    });
    it('returns plural for 0', () => {
      expect(pluralize(0, 'apple')).toBe('0 apples');
    });
    it('returns custom plural', () => {
      expect(pluralize(3, 'child', 'children')).toBe('3 children');
    });
  });

  describe('titleCase', () => {
    it('converts UPPER_CASE to title case', () => {
      expect(titleCase('HELLO_WORLD')).toBe('Hello World');
    });
    it('handles snake_case', () => {
      expect(titleCase('my_variable_name')).toBe('My Variable Name');
    });
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });
    it('formats KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });
    it('formats MB', () => {
      const mbResult = formatBytes(1048576);
      expect(mbResult).toMatch(/MB/);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// animation
// ═══════════════════════════════════════════════════════════

describe('animation', () => {
  it('has duration constants', () => {
    expect(DURATIONS.fast).toBe(150);
    expect(DURATIONS.normal).toBe(250);
    expect(DURATIONS.slow).toBe(400);
  });

  it('computes stagger delay', () => {
    expect(getStaggerDelay(0)).toBe('0ms');
    expect(getStaggerDelay(3)).toBe('150ms');
    expect(getStaggerDelay(5, 100)).toBe('500ms');
  });

  it('has easing curves', () => {
    expect(EASING.easeOut).toContain('cubic-bezier');
    expect(EASING.easeIn).toContain('cubic-bezier');
  });
});

// ═══════════════════════════════════════════════════════════
// color-utils
// ═══════════════════════════════════════════════════════════

describe('color-utils', () => {
  it('has brand colors', () => {
    expect(COLORS.primary).toBe('#7B68EE');
    expect(COLORS.success).toBe('#10b981');
    expect(COLORS.danger).toBe('#ef4444');
  });

  it('has chart colors', () => {
    expect(CHART_COLORS.length).toBe(6);
  });

  describe('lighten', () => {
    it('returns a hex color', () => {
      const result = lighten('#ff0000', 50);
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('lightens to white at 100%', () => {
      expect(lighten('#000000', 100)).toBe('#ffffff');
    });
    it('stays same at 0%', () => {
      expect(lighten('#7B68EE', 0)).toBe('#7b68ee');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// utils — additional coverage
// ═══════════════════════════════════════════════════════════

describe('utils-extended', () => {
  it('cn merges classes', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
    expect(cn('foo', false && 'bar')).toBe('foo');
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
    expect(cn()).toBe('');
  });

  it('shortenAddress formats correctly', () => {
    const addr = 'GBD7VK7JPSPIFW5QJQ7XMQWZLWYOMPYTLXQGZWSTHX4GJBRVXF4N4ABCD';      const short = shortenAddress(addr);
      // shortenAddress returns the original or shortened version
      expect(typeof short).toBe('string');
    expect(shortenAddress(addr).length).toBeLessThan(addr.length);
  });

  it('getStatusColor returns colors', () => {
    expect(getStatusColor('completed')).toBeDefined();
    expect(getStatusColor('pending')).toBeDefined();
    expect(getStatusColor('failed')).toBeDefined();
    expect(getStatusColor('')).toBeDefined(); // default fallback
  });
});
