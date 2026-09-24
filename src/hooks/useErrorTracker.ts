import { useCallback } from 'react';
import { captureError } from '../lib/sentry';

export const useErrorTracker = () => {
  const reportError = useCallback(
    (error: any, context?: Record<string, any>) => {
      const defaultContext = {
        release: process.env.NEXT_PUBLIC_RELEASE ?? 'unknown',
        segment: 'frontend',
      };
      captureError(error, { ...defaultContext, ...context });
    },
    []
  );
  return reportError;
};
