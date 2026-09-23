'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { trackError } from '@/hooks/useErrorTracker';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  segment?: string;
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const segment = this.props.segment || this.props.name || 'unknown';
    trackError(error, { segment, extra: { componentStack: errorInfo.componentStack } });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback({
            error: this.state.error || new Error('Unknown error'),
            reset: this.reset,
          });
        }
        return this.props.fallback;
      }

      return (
        <div className="p-6 rounded-lg border border-red-200 bg-red-50 text-red-900 my-4" data-testid="error-boundary-fallback">
          <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
          <p className="text-sm text-red-700 mb-4">
            {this.state.error?.message || 'An unexpected error occurred in this component.'}
          </p>
          {this.props.segment && (
            <p className="text-xs text-red-500 mb-4" data-testid="error-segment">
              Segment: {this.props.segment}
            </p>
          )}
          <button
            onClick={this.reset}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
