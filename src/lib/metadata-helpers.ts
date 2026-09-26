// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";

/** Fallback used when a page supplies no (or a blank) title. */
export const DEFAULT_PAGE_TITLE = "OphirPay";

/** Fallback used when a page supplies no (or a blank) description. */
export const DEFAULT_PAGE_DESCRIPTION =
  "Open-source payment orchestration layer for Stellar — smart contracts, webhooks, batch payments, refunds, multisig, and governance.";

interface PageMeta {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
}

/**
 * Generate consistent page metadata for SEO.
 *
 * The canonical URL and the Open Graph URL are both derived from
 * [`canonicalUrl`](@/lib/seo), so the two can never drift apart, and a blank
 * title/description falls back to a documented default instead of rendering
 * `undefined` into the document head.
 */
export function generateMetadata({
  title,
  description,
  path = "",
  noIndex = false,
}: PageMeta): Metadata {
  const resolvedTitle = title?.trim() || DEFAULT_PAGE_TITLE;
  const resolvedDescription = description?.trim() || DEFAULT_PAGE_DESCRIPTION;
  const url = canonicalUrl(path);

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    alternates: { canonical: url },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: resolvedTitle,
      description: resolvedDescription,
      url,
      siteName: "OphirPay",
      type: "website",
    },
  };
}
