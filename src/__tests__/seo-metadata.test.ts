// SPDX-License-Identifier: MIT

/**
 * Structured data, canonical URLs and page metadata (issue #721).
 *
 * These helpers build the payloads behind `<script type="application/ld+json">`
 * and `<link rel="canonical">`. A mistake here does not throw — it silently
 * publishes invalid structured data or a canonical URL pointing at the wrong
 * page — so the shape, the URL construction and the missing-input fallbacks
 * are pinned explicitly.
 */

import { describe, it, expect, afterEach } from "vitest";
import { getStructuredData } from "@/lib/json-ld";
import {
  canonicalUrl,
  baseUrl,
  breadcrumbJsonLd,
  DEFAULT_BASE_URL,
} from "@/lib/seo";
import {
  generateMetadata,
  DEFAULT_PAGE_TITLE,
  DEFAULT_PAGE_DESCRIPTION,
} from "@/lib/metadata-helpers";

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL_APP_URL === undefined) {
    delete process.env.NEXT_PUBLIC_APP_URL;
  } else {
    process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  }
});

/** Assert that no leaf of a payload is `undefined` (which JSON.stringify drops). */
function expectNoUndefined(value: unknown, path = "$"): void {
  expect(value, `${path} must not be undefined`).toBeDefined();
  if (Array.isArray(value)) {
    value.forEach((item, i) => expectNoUndefined(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      expect(
        child,
        `${path}.${key} must not be undefined — JSON.stringify would drop it`
      ).toBeDefined();
      expectNoUndefined(child, `${path}.${key}`);
    }
  }
}

function expectAbsoluteUrl(url: string): void {
  expect(() => new URL(url)).not.toThrow();
  expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
}

describe("getStructuredData (JSON-LD)", () => {
  it("returns the schema.org WebApplication shape with required fields", () => {
    const data = getStructuredData();

    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("WebApplication");
    expect(data.name).toBe("OphirPay");
    expect(data.applicationCategory).toBe("FinanceApplication");
    expect(data.operatingSystem).toBe("All");
    expect(data.offers).toEqual({
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    });
  });

  it("serializes with no undefined fields and survives a JSON round trip", () => {
    const data = getStructuredData();
    expectNoUndefined(data);

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("undefined");
    // No key is dropped and no value changes when the browser parses it.
    expect(JSON.parse(serialized)).toEqual(data);
  });

  it("emits an absolute url that falls back to the default origin", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const data = getStructuredData();

    expect(data.url).toBe(DEFAULT_BASE_URL);
    expectAbsoluteUrl(data.url);
  });

  it("honours NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://payments.example.org";

    expect(getStructuredData().url).toBe("https://payments.example.org");
  });
});

describe("canonicalUrl", () => {
  it("is the bare origin for no path and the origin root for '/'", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(canonicalUrl()).toBe(DEFAULT_BASE_URL);
    expect(canonicalUrl("/")).toBe(`${DEFAULT_BASE_URL}/`);
  });

  it("builds absolute URLs for nested and dynamic routes", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(canonicalUrl("/payments")).toBe(`${DEFAULT_BASE_URL}/payments`);
    expect(canonicalUrl("/payments/123")).toBe(`${DEFAULT_BASE_URL}/payments/123`);
    expect(canonicalUrl("/payments/clx0a1b2c3d4e5f6g7h8i9j0")).toBe(
      `${DEFAULT_BASE_URL}/payments/clx0a1b2c3d4e5f6g7h8i9j0`
    );
    for (const path of ["/", "/payments", "/payments/123", "/a/b/c/d"]) {
      expectAbsoluteUrl(canonicalUrl(path));
    }
  });

  it("normalises a missing or duplicated leading slash instead of concatenating", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    expect(canonicalUrl("payments")).toBe(`${DEFAULT_BASE_URL}/payments`);
    expect(canonicalUrl("//payments//123")).toBe(`${DEFAULT_BASE_URL}/payments//123`);
    expect(canonicalUrl("  /payments  ")).toBe(`${DEFAULT_BASE_URL}/payments`);

    // The bug this guards against: `${base}${path}` silently produced
    // "https://ophirpay.vercel.apppayments".
    expect(canonicalUrl("payments")).not.toBe(`${DEFAULT_BASE_URL}payments`);
  });

  it("never emits a double slash when the configured base has a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://payments.example.org/";

    expect(baseUrl()).toBe("https://payments.example.org");
    expect(canonicalUrl("")).toBe("https://payments.example.org");
    expect(canonicalUrl("/")).toBe("https://payments.example.org/");
    expect(canonicalUrl("/payments/123")).toBe(
      "https://payments.example.org/payments/123"
    );
    // The path is appended to the origin, never to a trailing slash.
    expect(new URL(canonicalUrl("/payments/123")).pathname).toBe("/payments/123");
    expect(canonicalUrl("/payments/123").replace("https://", "")).not.toContain("//");
  });

  it("falls back to the default origin for a blank or whitespace base URL", () => {
    for (const blank of ["", "   "]) {
      process.env.NEXT_PUBLIC_APP_URL = blank;
      expect(baseUrl()).toBe(DEFAULT_BASE_URL);
      expect(canonicalUrl("/send")).toBe(`${DEFAULT_BASE_URL}/send`);
    }
  });
});

describe("breadcrumbJsonLd", () => {
  it("wraps items in a schema.org BreadcrumbList", () => {
    const data = breadcrumbJsonLd([
      { name: "Home", url: "https://ophirpay.vercel.app/" },
      { name: "Payments", url: "https://ophirpay.vercel.app/payments" },
    ]);

    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://ophirpay.vercel.app/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Payments",
        item: "https://ophirpay.vercel.app/payments",
      },
    ]);
    expectNoUndefined(data);
  });

  it("numbers positions from 1 in list order, however many items there are", () => {
    const items = ["Home", "Audit log", "Entry"].map((name, i) => ({
      name,
      url: `https://ophirpay.vercel.app/level-${i + 1}`,
    }));

    const data = breadcrumbJsonLd(items);

    expect(data.itemListElement.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(data.itemListElement.map((e) => e.name)).toEqual(items.map((i) => i.name));
    // Every entry is a ListItem — a missing @type is the classic way
    // breadcrumbs get ignored by a crawler.
    expect(data.itemListElement.every((e) => e["@type"] === "ListItem")).toBe(true);
  });

  it("handles an empty trail", () => {
    const data = breadcrumbJsonLd([]);

    expect(data.itemListElement).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("undefined");
  });
});

describe("generateMetadata", () => {
  it("derives the canonical and Open Graph URLs from the same source", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const meta = generateMetadata({
      title: "Payments",
      description: "Track payments",
      path: "/payments/123",
    });

    const expected = `${DEFAULT_BASE_URL}/payments/123`;
    expect(meta.alternates?.canonical).toBe(expected);
    expect(meta.openGraph?.url).toBe(expected);
    expectAbsoluteUrl(String(meta.alternates?.canonical));
    expectAbsoluteUrl(String(meta.openGraph?.url));
  });

  it("defaults the path to the site root and robots to indexable", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const meta = generateMetadata({ title: "Dashboard", description: "Overview" });

    expect(meta.alternates?.canonical).toBe(DEFAULT_BASE_URL);
    expect(meta.openGraph?.url).toBe(DEFAULT_BASE_URL);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("honours an explicit noIndex", () => {
    const meta = generateMetadata({
      title: "Admin",
      description: "Internal",
      noIndex: true,
    });

    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("falls back to documented defaults when the title or description is missing", () => {
    const meta = generateMetadata({
      title: "",
      description: "   ",
    });

    expect(meta.title).toBe(DEFAULT_PAGE_TITLE);
    expect(meta.description).toBe(DEFAULT_PAGE_DESCRIPTION);
    // The Open Graph copy must not disagree with the document head.
    expect(meta.openGraph?.title).toBe(DEFAULT_PAGE_TITLE);
    expect(meta.openGraph?.description).toBe(DEFAULT_PAGE_DESCRIPTION);
  });

  it("falls back when the fields are omitted entirely", () => {
    const meta = generateMetadata({});

    expect(meta.title).toBe(DEFAULT_PAGE_TITLE);
    expect(meta.description).toBe(DEFAULT_PAGE_DESCRIPTION);
    expect(meta.alternates?.canonical).toBe(canonicalUrl(""));
  });

  it("trims supplied values and never serializes undefined", () => {
    const meta = generateMetadata({
      title: "  Payments  ",
      description: "  Track payments  ",
      path: "/payments",
    });

    expect(meta.title).toBe("Payments");
    expect(meta.description).toBe("Track payments");
    expect(meta.openGraph).toMatchObject({ siteName: "OphirPay", type: "website" });
    expectNoUndefined(meta);
  });
});
