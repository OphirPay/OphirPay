'use client';

import React, { ErrorInfo, ReactNode } from 'react';
import { useErrorTracker } from '@/hooks/useErrorTracker';

/**
 * Props for the ErrorBoundary component.
 * - `children` – the UI tree to protect.
 * - `segment` – optional identifier of the route segment (e.g., "payments").
 *   It is forwarded to the error‑tracking hook so that failures can be
 *   correlated with the part of the app that crashed.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  segment?: string;
}

/**
 * State kept by the boundary.
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * A classic React class‑component error boundary that integrates with the
 * `useErrorTracker` hook. When an error is caught it reports the error together
 * with the optional `segment` meta‑data.
 *
 * The UI rendered here is intentionally minimal – the per‑route `error.tsx`
 * files (see `src/app/*/error.tsx`) provide a richer fallback UI that preserves
 * the dashboard shell.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    // Trigger a re‑render with the fallback UI.
    return { hasError: true };
  }

  state: ErrorBoundaryState = { hasError: false };

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { segment } = this.props;
    const { trackError } = useErrorTracker();

    // Report the error with the segment (if any) for better observability.
    trackError(error, {
      segment,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      // The per‑segment `error.tsx` will be rendered by Next.js.
      // We keep this fallback extremely simple to avoid UI duplication.
      return (
        <div className="p-4 text-center">
          <p className="text-red-600">Something went wrong.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Helper wrapper for client‑side usage that automatically forwards the
 * `segment` prop.
 */
export const withErrorBoundary = (
  Component: React.ComponentType<any>,
  segment?: string,
) => {
  const Wrapped = (props: any) => (
    <ErrorBoundary segment={segment}>
      <Component {...props} />
    </ErrorBoundary>
  );
  // Preserve display name for debugging / React DevTools.
  const name = Component.displayName || Component.name || 'Component';
  Wrapped.displayName = `withErrorBoundary(${name})`;
  return Wrapped;
};
