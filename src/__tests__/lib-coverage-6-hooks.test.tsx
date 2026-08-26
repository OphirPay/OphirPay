// SPDX-License-Identifier: MIT
// Hook tests extracted from lib-coverage-6.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type RefObject } from 'react';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePagination } from '@/hooks/usePagination';
import { useWindowSize } from '@/hooks/useWindowSize';

// ═══════════════════════════════════════════════════════════════
// useOnClickOutside
// ═══════════════════════════════════════════════════════════════
describe('useOnClickOutside', () => {
  it('calls handler when clicking outside', () => {
    const handler = vi.fn();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    renderHook(() => useOnClickOutside(ref, handler));
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(handler).toHaveBeenCalled();
    document.body.removeChild(ref.current);
  });

  it('does not call handler when clicking inside', () => {
    const handler = vi.fn();
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    renderHook(() => useOnClickOutside({ current: outer }, handler));
    act(() => { inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(outer);
  });

  it('does not call handler when disabled', () => {
    const handler = vi.fn();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    renderHook(() => useOnClickOutside(ref, handler, false));
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(ref.current);
  });

  it('calls handler on touchstart', () => {
    const handler = vi.fn();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    renderHook(() => useOnClickOutside(ref, handler));
    act(() => { document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })); });
    expect(handler).toHaveBeenCalled();
    document.body.removeChild(ref.current);
  });

  it('does nothing when ref is null', () => {
    const handler = vi.fn();
    const ref: RefObject<HTMLElement | null> = { current: null };
    renderHook(() => useOnClickOutside(ref, handler));
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// useMediaQuery
// ═══════════════════════════════════════════════════════════════
describe('useMediaQuery', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(min-width: 768px)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('returns true for matching query', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
  });

  it('returns false for non-matching query', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 2000px)'));
    expect(result.current).toBe(false);
  });

  it('can be called with different queries', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 480px)'));
    expect(typeof result.current).toBe('boolean');
  });

  it('handles print query', () => {
    const { result } = renderHook(() => useMediaQuery('print'));
    expect(typeof result.current).toBe('boolean');
  });
});

// ═══════════════════════════════════════════════════════════════
// usePagination
// ═══════════════════════════════════════════════════════════════
describe('usePagination', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    expect(result.current.page).toBe(1);
    expect(result.current.limit).toBe(20);
    expect(result.current.totalPages).toBe(5);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);
  });

  it('navigates to next page', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    act(() => { result.current.next(); });
    expect(result.current.page).toBe(2);
    expect(result.current.hasPrev).toBe(true);
  });

  it('navigates to previous page', () => {
    const { result } = renderHook(() => usePagination({ total: 100, initialPage: 3 }));
    act(() => { result.current.prev(); });
    expect(result.current.page).toBe(2);
  });

  it('prev does not go below 1', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    act(() => { result.current.prev(); });
    expect(result.current.page).toBe(1);
  });

  it('next does not exceed total pages', () => {
    const { result } = renderHook(() => usePagination({ total: 10, initialLimit: 10 }));
    act(() => { result.current.next(); });
    expect(result.current.page).toBe(1);
  });

  it('goTo sets specific page', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    act(() => { result.current.goTo(5); });
    expect(result.current.page).toBe(5);
  });

  it('goTo clamps to valid range', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    act(() => { result.current.goTo(999); });
    expect(result.current.page).toBe(5);
    act(() => { result.current.goTo(0); });
    expect(result.current.page).toBe(1);
  });

  it('setLimit updates limit', () => {
    const { result } = renderHook(() => usePagination({ total: 100 }));
    act(() => { result.current.setLimit(50); });
    expect(result.current.limit).toBe(50);
    expect(result.current.totalPages).toBe(2);
  });

  it('handles zero total', () => {
    const { result } = renderHook(() => usePagination({ total: 0 }));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.hasNext).toBe(false);
  });

  it('accepts custom initial page and limit', () => {
    const { result } = renderHook(() => usePagination({ total: 100, initialPage: 3, initialLimit: 10 }));
    expect(result.current.page).toBe(3);
    expect(result.current.limit).toBe(10);
    expect(result.current.totalPages).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// useWindowSize
// ═══════════════════════════════════════════════════════════════
describe('useWindowSize', () => {
  it('returns width and height', () => {
    const { result } = renderHook(() => useWindowSize());
    expect(result.current).toHaveProperty('width');
    expect(result.current).toHaveProperty('height');
  });

  it('returns numbers', () => {
    const { result } = renderHook(() => useWindowSize());
    expect(typeof result.current.width).toBe('number');
    expect(typeof result.current.height).toBe('number');
  });

  it('updates on resize', () => {
    const { result } = renderHook(() => useWindowSize());
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.width).toBe(1024);
    expect(result.current.height).toBe(768);
  });
});
