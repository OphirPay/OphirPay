// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

// UI Components
import { Kbd } from '@/components/ui/Kbd';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';
import { CopyButton } from '@/components/ui/CopyButton';
import { Amount } from '@/components/ui/Amount';
import { Badge } from '@/components/ui/Badge';
import { ExplorerLink } from '@/components/ui/ExplorerLink';
import { Tooltip } from '@/components/ui/Tooltip';

// Hooks
import { useDebounce } from '@/hooks/useDebounce';
import { usePrevious } from '@/hooks/usePrevious';
import { useIsMounted, useMountedRef } from '@/hooks/useIsMounted';
import { useCountdown } from '@/hooks/useCountdown';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

// ═══════════════════════════════════════════════════════════
// UI Components
// ═══════════════════════════════════════════════════════════

describe('Kbd', () => {
  it('renders children', () => {
    render(<Kbd>⌘</Kbd>);
    expect(screen.getByText('⌘')).toBeDefined();
  });
  it('accepts className', () => {
    render(<Kbd className="test">K</Kbd>);
    expect(screen.getByText('K')).toBeDefined();
  });
});

describe('ProgressBar', () => {
  it('renders with value', () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });
  it('shows label', () => {
    render(<ProgressBar value={75} showLabel />);
    expect(screen.getByText('75%')).toBeDefined();
  });
  it('handles different variants', () => {
    render(<ProgressBar value={30} variant="success" />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });
});

describe('Skeleton', () => {
  it('renders', () => {
    render(<Skeleton />);
    const el = document.querySelector('[aria-hidden="true"]');
    expect(el).toBeDefined();
  });
  it('accepts dimensions', () => {
    render(<Skeleton width="100px" height="20px" />);
    const el = document.querySelector('[aria-hidden="true"]');
    expect(el).toBeDefined();
  });
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card><p>Content</p></Card>);
    expect(screen.getByText('Content')).toBeDefined();
  });
  it('renders title and subtitle', () => {
    render(<Card title="Title" subtitle="Sub"><p>Body</p></Card>);
    expect(screen.getByText('Title')).toBeDefined();
    expect(screen.getByText('Sub')).toBeDefined();
  });
  it('renders actions', () => {
    render(<Card actions={<button>Action</button>}><p>Body</p></Card>);
    expect(screen.getByText('Action')).toBeDefined();
  });
});

describe('Amount', () => {
  it('renders formatted amount', () => {
    render(<Amount value={100} asset="XLM" />);
    expect(screen.getByText(/100/)).toBeDefined();
    expect(screen.getByText(/XLM/)).toBeDefined();
  });
});

describe('Badge', () => {
  it('renders with text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeDefined();
  });
  it('accepts variant', () => {
    render(<Badge variant="success">Done</Badge>);
    expect(screen.getByText('Done')).toBeDefined();
  });
});

describe('CopyButton', () => {
  it('renders button', () => {
    render(<CopyButton value="copy-me" />);
    expect(screen.getByRole('button')).toBeDefined();
  });
});

describe('ExplorerLink', () => {
  it('returns null for empty value', () => {
    const { container } = render(<ExplorerLink value="" />);
    expect(container.innerHTML).toBe('');
  });
  it('renders link for tx', () => {
    render(<ExplorerLink value="abcd1234" kind="tx" />);
    expect(screen.getByRole('link')).toBeDefined();
  });
});

describe('Tooltip', () => {
  it('renders children', () => {
    render(<Tooltip content="Help"><button>Hover me</button></Tooltip>);
    expect(screen.getByText('Hover me')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════

describe('useDebounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300));
    expect(result.current).toBe('hello');
  });
  it('debounces updates', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'hello' } }
    );
    rerender({ value: 'world' });
    expect(result.current).toBe('hello');
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('world');
  });
});

describe('usePrevious', () => {
  it('returns undefined on first render', () => {
    const { result } = renderHook(() => usePrevious('hello'));
    expect(result.current).toBeUndefined();
  });
  it('returns previous value after update', () => {
    const { result, rerender } = renderHook(
      ({ value }) => usePrevious(value),
      { initialProps: { value: 'first' } }
    );
    rerender({ value: 'second' });
    expect(result.current).toBe('first');
  });
});

describe('useIsMounted', () => {
  it('returns true after mount', () => {
    const { result } = renderHook(() => useIsMounted());
    expect(result.current).toBe(true);
  });
});

describe('useMountedRef', () => {
  it('returns ref with current true', () => {
    const { result } = renderHook(() => useMountedRef());
    expect(result.current.current).toBe(true);
  });
});

describe('useCountdown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it('starts with initial seconds', () => {
    const { result } = renderHook(() => useCountdown(60));
    expect(result.current.remaining).toBe(60);
    expect(result.current.formatted).toBe('01:00');
  });
  it('counts down when started', () => {
    const { result } = renderHook(() => useCountdown(5));
    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.remaining).toBe(4);
  });
  it('calls onExpire', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useCountdown(2, onExpire));
    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onExpire).toHaveBeenCalled();
  });
  it('resets', () => {
    const { result } = renderHook(() => useCountdown(10));
    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { result.current.reset(60); });
    expect(result.current.remaining).toBe(60);
  });
});

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });
  it('copies text', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('test-text');
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test-text');
    expect(result.current.state.copied).toBe(true);
  });
  it('resets after delay', async () => {
    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => {
      await result.current.copy('test');
    });
    expect(result.current.state.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.state.copied).toBe(false);
  });
});
