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
