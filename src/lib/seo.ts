// SPDX-License-Identifier: MIT

/**
 * SEO utility helpers for generating sitemap entries, canonical URLs, etc.
 */

/** Used when `NEXT_PUBLIC_APP_URL` is unset or blank. */
export const DEFAULT_BASE_URL = "https://ophirpay.vercel.app";

/**
 * Site origin with the configured value honoured and any trailing slash
 * removed, so joining a path can never produce a double slash.
 *
 * Read lazily rather than at module load: a module-level constant freezes
 * whatever the environment happened to be at import time, which makes the
 * fallback untestable and wrong for runtime-configured deployments.
 */
export function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
  return origin.replace(/\/+$/, "");
}

/** Normalise a route path so it always starts with exactly one slash. */
function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  return `/${trimmed.replace(/^\/+/, "")}`;
}

/**
 * Get the full canonical URL for a path.
 *
 * Absolute for every input: `canonicalUrl("/payments/123")`,
 * `canonicalUrl("payments/123")` and a base URL with a trailing slash all
 * resolve to the same origin-relative URL.
 */
export function canonicalUrl(path = ""): string {
  return `${baseUrl()}${normalizePath(path)}`;
}

/** Generate a breadcrumb JSON-LD structure for rich search results. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
