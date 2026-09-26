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
export function reportWebVitals(metric: Metric | unknown): void {
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
    const win = window as unknown as {
      gtag?: (
        command: string,
        action: string,
        params: Record<string, unknown>
      ) => void;
    };
    win.gtag?.("event", "web_vitals", {
      metric_name: m.name,
      metric_value: m.value,
      metric_rating: m.rating,
      metric_delta: m.delta,
      event_category: "Web Vitals",
      non_interaction: true,
    });
  }
}
