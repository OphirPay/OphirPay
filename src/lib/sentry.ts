/**
 * Sentry wrapper that gracefully degrades when the SDK is not available.
 * It exposes a minimal API used by the application: initSentry and captureError.
 *
 * The wrapper is intentionally lightweight to avoid adding a hard dependency
 * on the Sentry SDK. If the SDK is missing, all calls become no-ops.
 */

let Sentry: any = null;

try {
  // @sentry/nextjs provides both client and server support
  Sentry = require('@sentry/nextjs');
} catch {
  // SDK not installed – provide a no-op implementation
  Sentry = {
    init: () => {},
    captureException: () => {},
    setTag: () => {},
    setRelease: () => {},
    setContext: () => {},
  };
}

/**
 * Initialise Sentry with the provided DSN and release.
 * The function is idempotent – calling it multiple times is safe.
 */
export const initSentry = (dsn?: string, release?: string) => {
  if (!dsn) return;
  Sentry.init({
    dsn,
    release,
    beforeSend(event) {
      // Redact PII: wallet addresses, amounts, and memo fields
      if (event.exception?.values) {
        event.exception.values.forEach((value: any) => {
          if (value.value) {
            // Redact hex wallet addresses (0x followed by 40 hex chars)
            value.value = value.value.replace(/0x[a-fA-F0-9]{40}/g, '[REDACTED]');
            // Redact numeric amounts (simple regex – adjust as needed)
            value.value = value.value.replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g, '[REDACTED]');
            // Redact memo strings
            value.value = value.value.replace(/memo:\s*\S+/gi, 'memo:[REDACTED]');
          }
        });
      }
      return event;
    },
  });
};

/**
 * Capture an exception with optional context information.
 * The context is merged into Sentry's context API.
 */
export const captureError = (error: any, context?: Record<string, any>) => {
  if (!Sentry || !Sentry.captureException) return;
  if (context) {
    Object.entries(context).forEach(([key, value]) => {
      Sentry.setContext(key, value);
    });
  }
  Sentry.captureException(error);
};

// Initialise Sentry immediately when this module is imported.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.NEXT_PUBLIC_RELEASE;
initSentry(dsn, release);
