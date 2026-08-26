// SPDX-License-Identifier: MIT

import type { Metadata } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app";

interface PageMeta {
  title: string;
  description: string;
  path?: string;
  noIndex?: boolean;
}

/**
 * Generate consistent page metadata for SEO.
 */
export function generateMetadata({
  title,
  description,
  path = "",
  noIndex = false,
}: PageMeta): Metadata {
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}${path}` },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}${path}`,
      siteName: "OphirPay",
      type: "website",
    },
  };
}
