/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useErrorTracker } from '@/hooks/useErrorTracker';

// Mock the error‑tracking hook
jest.mock('@/hooks/useErrorTracker', () => ({
  useErrorTracker: jest.fn(),
}));

// Helper component that throws on render
const Bomb = () => {
  throw new Error('boom');
};

describe('ErrorBoundary with segment tagging', () => {
  const trackErrorMock = jest.fn();

  beforeEach(() => {
    (useErrorTracker as jest.Mock).mockReturnValue({
      trackError: trackErrorMock,
    });
    trackErrorMock.mockClear();
  });

  it('catches errors, renders fallback and reports segment', () => {
    render(
      <ErrorBoundary segment="test-segment">
        <Bomb />
      </ErrorBoundary>,
    );

    // The simple fallback UI from the boundary should appear
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // The hook must have been called with the error and segment meta‑data
    expect(trackErrorMock).toHaveBeenCalledTimes(1);
    const [errorArg, metaArg] = trackErrorMock.mock.calls[0];
    expect(errorArg).toBeInstanceOf(Error);
    expect(errorArg.message).toBe('boom');
    expect(metaArg).toMatchObject({ segment: 'test-segment' });
  });
});
