// SPDX-License-Identifier: MIT

/**
 * JSON-LD structured data generator for better SEO.
 * Adds schema.org markup for WebApplication, Organization, etc.
 */

interface OphirPayStructuredData {
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
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "OphirPay",
    description:
      "The Open-Source Payment Orchestration Layer for Stellar — send, batch, schedule, and track blockchain payments.",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app",
    applicationCategory: "FinanceApplication",
    operatingSystem: "All",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
}
