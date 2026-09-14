// SPDX-License-Identifier: MIT

/**
 * Analytics event tracking utility.
 * In production, send events to your analytics platform (Google Analytics, Mixpanel, PostHog).
 */

type EventName =
  | "wallet_connect"
  | "wallet_disconnect"
  | "payment_sent"
  | "batch_created"
  | "page_view"
  | "feature_used"
  | "error_occurred";

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Track an analytics event.
 */
export function trackEvent(name: EventName, properties?: EventProperties): void {
  if (process.env.NODE_ENV === "development") {
    console.debug(`[Analytics] ${name}`, properties);
    return;
  }

  // Production: send to analytics platform
  if (typeof window !== "undefined" && "gtag" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gtag?.("event", name, properties);
  }
}

/**
 * Track a page view for SPA navigation.
 */
export function trackPageView(path: string): void {
  trackEvent("page_view", { path });

  if (typeof window !== "undefined" && "gtag" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gtag?.("config", process.env.NEXT_PUBLIC_GA_ID, {
      page_path: path,
    });
  }
}

// ---------------------------------------------------------------------------
// Error-reporting helpers used by app/error.tsx and app/global-error.tsx
// ---------------------------------------------------------------------------

const ERROR_REPORT_THROTTLE_MS = 60_000;
const recentErrorReports = new Map<string, number>();
let reportInProgress = false;

// Swappable reference so tests can intercept the tracking call without
// breaking the module-internal closure.
let _track: typeof trackEvent = trackEvent;

/** Swap the internal tracking function – exported only for tests. */
export function _setTrackFnForTests(fn: typeof trackEvent): void {
  _track = fn;
}

/**
 * Strip query parameters, hash fragments, and any sensitive patterns from a
 * pathname so it is safe to include in analytics without leaking secrets.
 */
export function sanitizeRoute(pathname: string): string {
  if (!pathname || typeof pathname !== "string") return "/unknown";

  let clean = pathname.split("?")[0].split("#")[0];

  // Redact Stellar secret-key-like patterns (S... 57 chars)
  clean = clean.replace(/S[A-Z0-9]{55}/g, "[REDACTED]");
  // Redact long hex strings that could be private keys / hashes
  clean = clean.replace(/[0-9a-f]{40,}/gi, "[REDACTED]");

  // Normalise trailing slash (keep root as-is)
  if (clean.length > 1 && clean.endsWith("/")) {
    clean = clean.slice(0, -1);
  }

  return clean || "/";
}

/**
 * Report an error rendered by a fallback boundary.
 *
 * - Sanitises the current route.
 * - Throttles duplicate reports (same message + route) within a 60 s window.
 * - Guards against report loops via a module-level re-entrancy flag.
 */
export function reportRenderedError(
  error: Error & { digest?: string },
  overridePath?: string,
): void {
  if (reportInProgress) return; // prevent recursion

  const route =
    overridePath ??
    (typeof window !== "undefined" ? window.location.pathname : "/unknown");
  const safeRoute = sanitizeRoute(route);
  const message = error?.message || "Unknown error";

  const key = `${safeRoute}::${message}`;
  const now = Date.now();
  if (recentErrorReports.has(key)) {
    const last = recentErrorReports.get(key)!;
    if (now - last < ERROR_REPORT_THROTTLE_MS) return;
  }
  recentErrorReports.set(key, now);

  reportInProgress = true;
  try {
    _track("error_occurred", {
      route: safeRoute,
      message,
    });
  } catch {
    // Swallow analytics failures so the fallback UI is never broken
    // by a reporting error.
  } finally {
    reportInProgress = false;
  }
}

/**
 * Reset throttle state – exported only for tests.
 */
export function _resetErrorReportState(): void {
  recentErrorReports.clear();
  reportInProgress = false;
}
