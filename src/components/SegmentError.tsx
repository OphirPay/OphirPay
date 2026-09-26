'use client';

import { useEffect } from 'react';
import { useErrorTracker } from '@/hooks/useErrorTracker';

export interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  segment: string;
  title?: string;
}

export function SegmentError({ error, reset, segment, title }: SegmentErrorProps) {
  const { trackError } = useErrorTracker();

  useEffect(() => {
    trackError(error, { segment });
  }, [error, segment, trackError]);

  const displayTitle =
    title ||
    `${segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')} Error`;

  return (
    <div
      className="p-6 my-4 rounded-xl border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/50 text-red-900 dark:text-red-200 shadow-sm"
      data-testid={`segment-error-${segment}`}
    >
      <div className="flex items-start gap-4">
        <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg text-red-600 dark:text-red-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {displayTitle}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {error.message || 'An unexpected error occurred while loading this section.'}
          </p>
          <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 font-mono" data-testid="segment-name">
            Segment: {segment}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-ophir-600 hover:bg-ophir-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-ophir-500 focus:ring-offset-2"
              data-testid="retry-button"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
