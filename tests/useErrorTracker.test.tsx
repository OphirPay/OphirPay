import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { useErrorTracker } from '../src/hooks/useErrorTracker';
import { captureError } from '../src/lib/sentry';

jest.mock('../src/lib/sentry', () => ({
  captureError: jest.fn(),
}));

const TestComponent = () => {
  const report = useErrorTracker();
  useEffect(() => {
    report(new Error('Hook error'), { extra: 'data' });
  }, [report]);

  return <div>Test</div>;
};

describe('useErrorTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_RELEASE = 'test-release';
  });

  it('reports errors with default context', () => {
    render(<TestComponent />);
    expect(captureError).toHaveBeenCalledTimes(1);
    const [error, context] = captureError.mock.calls[0];
    expect(error.message).toBe('Hook error');
    expect(context).toMatchObject({
      release: 'test-release',
      segment: 'frontend',
      extra: 'data',
    });
  });
});
