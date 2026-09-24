// SPDX-License-Identifier: MIT

import type { Metadata } from "next";

import { canonicalUrl } from "./seo";

export const DEFAULT_TITLE = "OphirPay — Stellar Payment Orchestration";
export const DEFAULT_DESCRIPTION =
  "The Open-Source Payment Orchestration Layer for Stellar — send, batch, schedule, and track blockchain payments.";

export interface PageMeta {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
}

/**
 * Generate consistent page metadata for SEO.
 */
export function generateMetadata({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path = "",
  noIndex = false,
}: PageMeta = {}): Metadata {
  const finalTitle = title?.trim() || DEFAULT_TITLE;
  const finalDescription = description?.trim() || DEFAULT_DESCRIPTION;
  const url = canonicalUrl(path);

  return {
    title: finalTitle,
    description: finalDescription,
    alternates: { canonical: url },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: finalTitle,
      description: finalDescription,
      url,
      siteName: "OphirPay",
      type: "website",
    },
  };
}
