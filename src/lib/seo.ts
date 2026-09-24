// SPDX-License-Identifier: MIT

/**
 * SEO utility helpers for generating sitemap entries, canonical URLs, etc.
 */

export const DEFAULT_APP_URL = "https://ophirpay.vercel.app";

/** Get the configured base URL without trailing slash. */
export function getBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (envUrl || DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** Get the full canonical URL for a path. */
export function canonicalUrl(path = ""): string {
  const base = getBaseUrl();
  if (!path || path === "/") {
    return `${base}/`;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface BreadcrumbJsonLd {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: {
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }[];
}

/** Generate a breadcrumb JSON-LD structure for rich search results. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): BreadcrumbJsonLd {
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
