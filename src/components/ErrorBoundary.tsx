import React, { Component, ErrorInfo, ReactNode } from 'react';
import { captureError } from '../lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const context = {
      release: process.env.NEXT_PUBLIC_RELEASE ?? 'unknown',
      segment: 'frontend',
      componentStack: info.componentStack,
    };
    captureError(error, context);
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>;
    }
    return this.props.children;
  }
}
