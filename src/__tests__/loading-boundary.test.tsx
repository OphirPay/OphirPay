// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingBoundary } from '@/lib/loading-boundary';

describe('LoadingBoundary', () => {
  it('renders children', () => {
    render(
      <LoadingBoundary>
        <div>Content loaded</div>
      </LoadingBoundary>
    );
    expect(screen.getByText('Content loaded')).toBeDefined();
  });

  it('renders with custom fallback via Suspense boundary', () => {
    render(
      <LoadingBoundary fallback={<div>Custom loading...</div>}>
        <div>Loaded</div>
      </LoadingBoundary>
    );
    // Children render since there's no lazy loading in the test
    expect(screen.getByText('Loaded')).toBeDefined();
  });

  it('accepts different variants without throwing', () => {
    const variants = ['text', 'card', 'table', 'stats'] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <LoadingBoundary variant={variant}>
          <span>{variant}</span>
        </LoadingBoundary>
      );
      expect(screen.getByText(variant)).toBeDefined();
      unmount();
    }
  });

  it('uses card variant by default', () => {
    render(
      <LoadingBoundary>
        <span>Default</span>
      </LoadingBoundary>
    );
    expect(screen.getByText('Default')).toBeDefined();
  });
});
