// SPDX-License-Identifier: MIT

/**
 * Web Vitals tracking integration.
 * In production, send metrics to your analytics platform (Vercel Analytics, Google Analytics, etc.).
 *
 * Usage (in app/layout.tsx):
 *   import { reportWebVitals } from "@/lib/web-vitals";
 *   export { reportWebVitals };
 */

interface Metric {
  id: string;
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  entries: PerformanceEntry[];
}

/**
 * Report Web Vitals to console in development, or to analytics in production.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reportWebVitals(metric: any): void {
  // Cast to Metric for type safety
  const m = metric as Metric;

  if (process.env.NODE_ENV === "development") {
    console.debug(
      `[Web Vitals] ${m.name}: ${m.value.toFixed(1)} (${m.rating})`
    );
    return;
  }

  // Production: send to Vercel Analytics or Google Analytics
  if (typeof window !== "undefined" && "gtag" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).gtag?.("event", "web_vitals", {
      metric_name: m.name,
      metric_value: m.value,
      metric_rating: m.rating,
      metric_delta: m.delta,
      event_category: "Web Vitals",
      non_interaction: true,
    });
  }
}
