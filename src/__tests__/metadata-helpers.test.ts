// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getStructuredData } from "@/lib/json-ld";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, generateMetadata } from "@/lib/metadata-helpers";
import { breadcrumbJsonLd, canonicalUrl, DEFAULT_APP_URL, getBaseUrl } from "@/lib/seo";

describe("metadata-helpers and structured data (Issue #721)", () => {
  const originalEnvUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalEnvUrl !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = originalEnvUrl;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  describe("getStructuredData (JSON-LD WebApplication)", () => {
    it("returns schema.org WebApplication specification with required fields", () => {
      const data = getStructuredData();

      expect(data["@context"]).toBe("https://schema.org");
      expect(data["@type"]).toBe("WebApplication");
      expect(data.name).toBe("OphirPay");
      expect(data.description).toBeTruthy();
      expect(data.applicationCategory).toBe("FinanceApplication");
      expect(data.operatingSystem).toBe("All");
      expect(data.offers).toEqual({
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      });
    });

    it("serializes to valid JSON without undefined values", () => {
      const data = getStructuredData();
      const serialized = JSON.stringify(data);
      const parsed = JSON.parse(serialized);

      expect(parsed).toEqual(data);
      expect(serialized).not.toContain("undefined");
      expect(serialized).toContain('"@context":"https://schema.org"');
      expect(serialized).toContain('"@type":"WebApplication"');
    });

    it("falls back to DEFAULT_APP_URL when NEXT_PUBLIC_APP_URL is unset or empty", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      expect(getStructuredData().url).toBe("https://ophirpay.vercel.app");

      process.env.NEXT_PUBLIC_APP_URL = "   ";
      expect(getStructuredData().url).toBe("https://ophirpay.vercel.app");
    });

    it("uses configured NEXT_PUBLIC_APP_URL and strips trailing slashes", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://checkout.ophirpay.com///";
      expect(getStructuredData().url).toBe("https://checkout.ophirpay.com");
    });
  });

  describe("canonicalUrl and getBaseUrl (SEO helpers)", () => {
    it("returns default base url when env variable is not set", () => {
      expect(getBaseUrl()).toBe(DEFAULT_APP_URL);
    });

    it("normalizes root paths cleanly", () => {
      expect(canonicalUrl()).toBe(`${DEFAULT_APP_URL}/`);
      expect(canonicalUrl("")).toBe(`${DEFAULT_APP_URL}/`);
      expect(canonicalUrl("/")).toBe(`${DEFAULT_APP_URL}/`);
    });

    it("ensures leading slash for single segment paths", () => {
      expect(canonicalUrl("/send")).toBe(`${DEFAULT_APP_URL}/send`);
      expect(canonicalUrl("send")).toBe(`${DEFAULT_APP_URL}/send`);
    });

    it("handles deeply nested dynamic routes accurately", () => {
      expect(canonicalUrl("/escrow/0xabc123/milestones/4")).toBe(
        `${DEFAULT_APP_URL}/escrow/0xabc123/milestones/4`
      );
      expect(canonicalUrl("escrow/0xabc123/milestones/4")).toBe(
        `${DEFAULT_APP_URL}/escrow/0xabc123/milestones/4`
      );
    });

    it("prevents double slashes when env variable has trailing slash", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://custom.ophirpay.io/";
      expect(canonicalUrl("/batches")).toBe("https://custom.ophirpay.io/batches");
      expect(canonicalUrl("batches")).toBe("https://custom.ophirpay.io/batches");
      expect(canonicalUrl("")).toBe("https://custom.ophirpay.io/");
    });
  });

  describe("breadcrumbJsonLd (BreadcrumbList Schema)", () => {
    it("creates valid BreadcrumbList structure with 1-based sequential indices", () => {
      const items = [
        { name: "Home", url: "https://ophirpay.vercel.app" },
        { name: "Payments", url: "https://ophirpay.vercel.app/payments" },
        { name: "Batch #42", url: "https://ophirpay.vercel.app/payments/batch/42" },
      ];

      const jsonLd = breadcrumbJsonLd(items);

      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd["@type"]).toBe("BreadcrumbList");
      expect(jsonLd.itemListElement).toHaveLength(3);

      expect(jsonLd.itemListElement[0]).toEqual({
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://ophirpay.vercel.app",
      });
      expect(jsonLd.itemListElement[1]).toEqual({
        "@type": "ListItem",
        position: 2,
        name: "Payments",
        item: "https://ophirpay.vercel.app/payments",
      });
      expect(jsonLd.itemListElement[2]).toEqual({
        "@type": "ListItem",
        position: 3,
        name: "Batch #42",
        item: "https://ophirpay.vercel.app/payments/batch/42",
      });
    });

    it("handles empty items list", () => {
      const jsonLd = breadcrumbJsonLd([]);
      expect(jsonLd["@type"]).toBe("BreadcrumbList");
      expect(jsonLd.itemListElement).toEqual([]);
    });

    it("serializes without undefined fields", () => {
      const jsonLd = breadcrumbJsonLd([{ name: "Send", url: "https://ophirpay.vercel.app/send" }]);
      const str = JSON.stringify(jsonLd);
      expect(str).not.toContain("undefined");
      expect(JSON.parse(str)).toEqual(jsonLd);
    });
  });

  describe("generateMetadata (Page SEO Metadata)", () => {
    it("generates complete metadata with custom title and description", () => {
      const meta = generateMetadata({
        title: "Send Payment",
        description: "Initiate single or batch Stellar payments with fee optimization.",
        path: "/send",
      });

      expect(meta.title).toBe("Send Payment");
      expect(meta.description).toBe(
        "Initiate single or batch Stellar payments with fee optimization."
      );
      expect(meta.alternates?.canonical).toBe("https://ophirpay.vercel.app/send");
      expect(meta.robots).toEqual({ index: true, follow: true });
      expect(meta.openGraph).toEqual({
        title: "Send Payment",
        description: "Initiate single or batch Stellar payments with fee optimization.",
        url: "https://ophirpay.vercel.app/send",
        siteName: "OphirPay",
        type: "website",
      });
    });

    it("falls back to default title and description when omitted or empty", () => {
      const emptyMeta = generateMetadata({
        title: "",
        description: "   ",
        path: "",
      });

      expect(emptyMeta.title).toBe(DEFAULT_TITLE);
      expect(emptyMeta.description).toBe(DEFAULT_DESCRIPTION);
      expect(emptyMeta.openGraph?.title).toBe(DEFAULT_TITLE);
      expect(emptyMeta.openGraph?.description).toBe(DEFAULT_DESCRIPTION);
    });

    it("applies default arguments when called with no params", () => {
      const defaultMeta = generateMetadata();

      expect(defaultMeta.title).toBe(DEFAULT_TITLE);
      expect(defaultMeta.description).toBe(DEFAULT_DESCRIPTION);
      expect(defaultMeta.alternates?.canonical).toBe("https://ophirpay.vercel.app/");
      expect(defaultMeta.robots).toEqual({ index: true, follow: true });
    });

    it("sets robots to noindex and nofollow when noIndex is true", () => {
      const privateMeta = generateMetadata({
        title: "Admin Audit",
        description: "Internal audit logs",
        path: "/admin/audit",
        noIndex: true,
      });

      expect(privateMeta.robots).toEqual({ index: false, follow: false });
    });

    it("normalizes canonical path for nested dynamic routes in metadata", () => {
      const nestedMeta = generateMetadata({
        title: "Address Book Contact",
        description: "Contact details",
        path: "address-book/contacts/GBBD47...",
      });

      expect(nestedMeta.alternates?.canonical).toBe(
        "https://ophirpay.vercel.app/address-book/contacts/GBBD47..."
      );
      expect(nestedMeta.openGraph?.url).toBe(
        "https://ophirpay.vercel.app/address-book/contacts/GBBD47..."
      );
    });
  });
});
