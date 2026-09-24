// SPDX-License-Identifier: MIT

/**
 * JSON-LD structured data generator for better SEO.
 * Adds schema.org markup for WebApplication, Organization, etc.
 */

export interface OphirPayStructuredData {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  description: string;
  url: string;
  applicationCategory: "FinanceApplication";
  operatingSystem: "All";
  offers: {
    "@type": "Offer";
    price: "0";
    priceCurrency: "USD";
  };
}

/**
 * Generate JSON-LD structured data for the OphirPay app.
 * Include this in the <head> via a <script type="application/ld+json"> tag.
 */
export function getStructuredData(): OphirPayStructuredData {
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const url = (rawUrl || "https://ophirpay.vercel.app").replace(/\/+$/, "");

  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "OphirPay",
    description:
      "The Open-Source Payment Orchestration Layer for Stellar — send, batch, schedule, and track blockchain payments.",
    url,
    applicationCategory: "FinanceApplication",
    operatingSystem: "All",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}
