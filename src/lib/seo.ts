// SPDX-License-Identifier: MIT

/**
 * SEO utility helpers for generating sitemap entries, canonical URLs, etc.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";

/** Get the full canonical URL for a path. */
export function canonicalUrl(path = ""): string {
  return `${BASE_URL}${path}`;
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
