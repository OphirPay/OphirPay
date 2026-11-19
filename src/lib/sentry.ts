// SPDX-License-Identifier: MIT

import * as Sentry from "@sentry/nextjs";

interface ErrorContext {
  component?: string;
  userId?: string;
  url?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function initializeSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
  });
}

export function captureError(error: Error, context?: ErrorContext): void {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, {
      tags: {
        ...context?.tags,
        ...(context?.component ? { component: context.component } : {}),
      },
      extra: context?.extra,
    });
  } else if (process.env.NODE_ENV === "production") {
    console.error("[OphirPay]", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...context,
    });
  } else {
    console.error("[OphirPay Dev]", error);
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureMessage(message, { level });
  } else if (process.env.NODE_ENV === "production") {
    console.log(`[OphirPay ${level}]`, message);
  }
}

/**
 * Set user context for error tracking (Stellar address for anonymous users).
 */
export function setUserContext(publicKey: string): void {
  try {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.setUser({ id: publicKey });
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("ophir-user-id", publicKey);
    }
  } catch {
    // Silently ignore in SSR
  }
}
