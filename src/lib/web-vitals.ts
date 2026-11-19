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
export function reportWebVitals(metric: Metric): void {
  if (process.env.NODE_ENV === "development") {
    console.debug(
      `[Web Vitals] ${metric.name}: ${metric.value.toFixed(1)} (${metric.rating})`
    );
    return;
  }

  // Production: send to Vercel Analytics or Google Analytics
  if (typeof window !== "undefined" && "gtag" in window) {
    window.gtag?.("event", "web_vitals", {
      metric_name: metric.name,
      metric_value: metric.value,
      metric_rating: metric.rating,
      metric_delta: metric.delta,
      event_category: "Web Vitals",
      non_interaction: true,
    });
  }
}
