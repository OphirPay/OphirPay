// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SegmentError } from '@/components/SegmentError';
import { captureError } from '@/lib/sentry';

vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

// Component that throws
function BrokenComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <div>Working</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('renders custom fallback on error', () => {
    // Suppress expected error logs
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom Error UI</div>}>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error UI')).toBeDefined();

    spy.mockRestore();
  });

  it('renders default fallback on error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Test error')).toBeDefined();
    expect(screen.getByText('Try Again')).toBeDefined();

    spy.mockRestore();
  });

  it('renders without error message when error has no message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ThrowEmpty = () => {
      throw new Error();
      return null;
    };

    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );

    expect(screen.getByText('An unexpected error occurred.')).toBeDefined();

    spy.mockRestore();
  });

  it('reports the segment tag when a segment boundary catches (issue #791)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(captureError).mockClear();

    render(
      <ErrorBoundary segment="payments">
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      tags: { segment: 'payments' },
    });

    spy.mockRestore();
  });

  it('does not report when no segment is set', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(captureError).mockClear();

    render(
      <ErrorBoundary>
        <BrokenComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(captureError).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('SegmentError', () => {
  it('renders the segment title with a working retry action', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(captureError).mockClear();
    const reset = vi.fn();

    render(
      <SegmentError
        error={new Error('Boom')}
        reset={reset}
        segment="analytics"
        title="Analytics"
      />
    );

    expect(screen.getByText('Analytics hit a problem')).toBeDefined();
    expect(screen.getByText('Boom')).toBeDefined();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      tags: { segment: 'analytics' },
    });

    fireEvent.click(screen.getByText('Try Again'));
    expect(reset).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
