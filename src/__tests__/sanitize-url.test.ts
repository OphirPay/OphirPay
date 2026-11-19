// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  sanitizeImageUrl,
  isSafeImageUrl,
  ALLOWED_IMAGE_DATA_TYPES,
} from "@/lib/sanitize-url";

// A minimal but valid base64 payload (1x1 transparent PNG) + fake siblings.
const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const JPEG_DATA_URI = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ";
const WEBP_DATA_URI = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAv";

describe("sanitizeImageUrl — accepted inputs", () => {
  it("allows absolute https URLs", () => {
    expect(sanitizeImageUrl("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png"
    );
    // Scheme/host case is normalized by URL parsing.
    expect(sanitizeImageUrl("HTTPS://CDN.EXAMPLE.COM/logo.png")).toBe(
      "https://cdn.example.com/logo.png"
    );
  });

  it("allows base64 data URIs of the permitted raster types", () => {
    expect(sanitizeImageUrl(PNG_DATA_URI)).toBe(PNG_DATA_URI);
    expect(sanitizeImageUrl(JPEG_DATA_URI)).toBe(JPEG_DATA_URI);
    expect(sanitizeImageUrl(WEBP_DATA_URI)).toBe(WEBP_DATA_URI);
    // Parameters before `;base64` are tolerated.
    expect(
      sanitizeImageUrl("data:image/png;charset=utf-8;base64,AAAA")
    ).toBe("data:image/png;charset=utf-8;base64,AAAA");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeImageUrl("  https://cdn.example.com/a.png \n")).toBe(
      "https://cdn.example.com/a.png"
    );
  });

  it("exposes the permitted data media types", () => {
    expect(ALLOWED_IMAGE_DATA_TYPES).toContain("image/png");
    expect(ALLOWED_IMAGE_DATA_TYPES).not.toContain("image/svg+xml");
  });
});

describe("sanitizeImageUrl — rejected inputs", () => {
  it("blocks dangerous schemes", () => {
    for (const url of [
      "javascript:alert(document.domain)",
      "vbscript:msgbox(1)",
      "http://cdn.example.com/logo.png",
      "file:///etc/passwd",
      "blob:https://evil.example.com/uuid",
      "ftp://example.com/x.png",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    ]) {
      expect(sanitizeImageUrl(url)).toBeNull();
    }
  });

  it("blocks SVG data URIs (a scripting format)", () => {
    expect(
      sanitizeImageUrl(
        "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+"
      )
    ).toBeNull();
    expect(
      sanitizeImageUrl('data:image/svg+xml,<svg onload="alert(1)"/>')
    ).toBeNull();
  });

  it("blocks non-base64 data URIs even of an allowed media type", () => {
    // A raw document body could smuggle markup a media-type check alone misses.
    expect(sanitizeImageUrl("data:image/png,<script>alert(1)</script>")).toBeNull();
  });

  it("blocks script-bearing fragments", () => {
    for (const url of [
      "https://cdn.example.com/<script>alert(1)</script>.png",
      "https://cdn.example.com/x.png?onerror=alert(1)",
      "https://cdn.example.com/x.png\" onload=alert(1)",
      "https://cdn.example.com/<svg/onload=alert(1)>",
    ]) {
      expect(sanitizeImageUrl(url)).toBeNull();
    }
  });

  it("blocks schemes obfuscated with control characters", () => {
    expect(sanitizeImageUrl("java\tscript:alert(1)")).toBeNull();
    expect(sanitizeImageUrl("java\nscript:alert(1)")).toBeNull();
    expect(sanitizeImageUrl("\u0000javascript:alert(1)")).toBeNull();
  });

  it("blocks protocol-relative and relative URLs", () => {
    expect(sanitizeImageUrl("//evil.example.com/logo.png")).toBeNull();
    expect(sanitizeImageUrl("/api/assets/logo.png")).toBeNull();
    expect(sanitizeImageUrl("logo.png")).toBeNull();
  });

  it("blocks non-string and empty input", () => {
    expect(sanitizeImageUrl(null)).toBeNull();
    expect(sanitizeImageUrl(undefined)).toBeNull();
    expect(sanitizeImageUrl("")).toBeNull();
    expect(sanitizeImageUrl("   ")).toBeNull();
    expect(sanitizeImageUrl(42)).toBeNull();
    expect(sanitizeImageUrl({ toString: () => "https://x/y.png" })).toBeNull();
  });

  it("blocks excessively long input", () => {
    expect(
      sanitizeImageUrl(`https://cdn.example.com/${"a".repeat(4096)}.png`)
    ).toBeNull();
  });

  it("does not false-positive on a query string containing 'on…='", () => {
    // `?monkey=1` contains the substring `onkey=`, which naive event-handler
    // detection would reject.
    expect(
      sanitizeImageUrl("https://cdn.example.com/logo.png?monkey=1")
    ).toBe("https://cdn.example.com/logo.png?monkey=1");
  });
});

describe("isSafeImageUrl", () => {
  it("mirrors sanitizeImageUrl's acceptance", () => {
    expect(isSafeImageUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl(null)).toBe(false);
  });
});
