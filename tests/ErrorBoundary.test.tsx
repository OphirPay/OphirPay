import React from 'react';
import { render } from '@testing-library/react';
import ErrorBoundary from '../src/components/ErrorBoundary';
import { captureError } from '../src/lib/sentry';

jest.mock('../src/lib/sentry', () => ({
  captureError: jest.fn(),
}));

const Problematic = () => {
  throw new Error(
    'Test error with wallet 0x1234567890abcdef1234567890abcdef12345678 and amount 1000'
  );
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_RELEASE = 'test-release';
  });

  it('captures errors and renders fallback UI', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Problematic />
      </ErrorBoundary>
    );

    expect(getByText('Something went wrong.')).toBeInTheDocument();
    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, context] = captureError.mock.calls[0];
    expect(error.message).toContain('Test error with wallet');
    expect(context).toMatchObject({
      release: 'test-release',
      segment: 'frontend',
      componentStack: expect.any(String),
    });
  });
});
