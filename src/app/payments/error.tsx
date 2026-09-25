'use client';

import { useEffect } from 'react';
import { useErrorTracker } from '@/hooks/useErrorTracker';
import Link from 'next/link';

interface ErrorProps {
  error: Error;
  reset: () => void;
}

/**
 * Error UI for the **Payments** segment.
 * It keeps the dashboard layout (navigation, header, etc.) intact while
 * presenting a retry button and reporting the failure with the segment tag.
 */
export default function PaymentsError({ error, reset }: ErrorProps) {
  const { trackError } = useErrorTracker();

  useEffect(() => {
    trackError(error, { segment: 'payments' });
  }, [error, trackError]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-red-600">
        Payments page failed to load
      </h2>
      <p className="mt-2 text-gray-700">{error.message}</p>

      <div className="mt-4 flex space-x-4">
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
        >
          Retry
        </button>
        <Link href="/dashboard">
          <a className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">
            Back to Dashboard
          </a>
        </Link>
      </div>
    </div>
  );
}
