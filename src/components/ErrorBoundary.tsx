"use client";
// SPDX-License-Identifier: MIT


import { Component, type ReactNode } from "react";
import { captureError } from "@/lib/sentry";

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error | null; reset: () => void }) => ReactNode);
  segment?: string;
  onRetry?: () => void;
}

export function WidgetErrorFallback({
  title = "Widget unavailable",
  error,
  onRetry,
}: {
  title?: string;
  error?: Error | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="widget-error-fallback"
      className="rounded-xl border border-red-200 dark:border-red-800/70 bg-red-50/70 dark:bg-red-950/20 p-5 text-center"
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </p>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {error?.message || "Failed to render this analytics widget."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-ophir-600 text-white text-xs font-medium hover:bg-ophir-700 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV !== "production" && errorInfo.componentStack) {
      console.error(
        `[ErrorBoundary${this.props.segment ? `:${this.props.segment}` : ""}]`,
        error,
        errorInfo.componentStack
      );
    }
    captureError(error, {
      component: "ErrorBoundary",
      ...(this.props.segment ? { tags: { segment: this.props.segment } } : {}),
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback({
          error: this.state.error,
          reset: this.reset,
        });
      }
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8 animate-fade-in">
          <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
            <div className="h-16 w-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-8 h-8 text-red-600 dark:text-red-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-ophir-600 text-white text-sm font-medium hover:bg-ophir-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
