// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import path from "path";
import { runDocLinkChecker, getHeadingSlugs } from "../../scripts/check-doc-links.mjs";

describe("Documentation Link & Anchor Checker", () => {
  it("should validate all markdown documentation in the repository with zero broken internal links", () => {
    const result = runDocLinkChecker({ checkExternal: false });

    if (result.internalErrors.length > 0) {
      console.error("Internal link errors found:", result.internalErrors);
    }

    expect(result.totalFiles).toBeGreaterThan(35);
    expect(result.internalErrors).toEqual([]);
  });

  describe("getHeadingSlugs", () => {
    it("handles plain headings", () => {
      const slugs = getHeadingSlugs("Prerequisites");
      expect(slugs).toContain("prerequisites");
    });

    it("handles emoji prefixes and preserves both GitHub leading-dash and clean slugs", () => {
      const slugs = getHeadingSlugs("⚡ Quick Start");
      expect(slugs).toContain("-quick-start");
      expect(slugs).toContain("quick-start");
    });

    it("handles ampersands and punctuation with multi-dash spacing", () => {
      const slugs = getHeadingSlugs("1. Authentication & API Keys");
      expect(slugs).toContain("1-authentication--api-keys");
      expect(slugs).toContain("1-authentication-api-keys");
    });

    it("handles em-dashes and multi-dash spacing", () => {
      const slugs = getHeadingSlugs("Phase 4 — Record addresses and hashes");
      expect(slugs).toContain("phase-4--record-addresses-and-hashes");
      expect(slugs).toContain("phase-4-record-addresses-and-hashes");
    });

    it("handles Unicode accented characters in French headings", () => {
      const slugs = getHeadingSlugs("📡 Événements en Temps Réel");
      expect(slugs).toContain("-événements-en-temps-réel");
      expect(slugs).toContain("événements-en-temps-réel");
    });

    it("handles Japanese CJK characters", () => {
      const slugs = getHeadingSlugs("✨ なぜOphirPay？");
      expect(slugs).toContain("-なぜophirpay");
      expect(slugs).toContain("なぜophirpay");
    });

    it("handles variation selectors in emojis", () => {
      const slugs = getHeadingSlugs("🛡️ Security Audit");
      expect(slugs.some((s) => s.includes("security-audit"))).toBe(true);
    });

    it("handles French question mark spacing", () => {
      const slugs = getHeadingSlugs("✨ Pourquoi OphirPay ?");
      expect(slugs).toContain("-pourquoi-ophirpay");
      expect(slugs).toContain("pourquoi-ophirpay");
    });
  });

  describe("External host allowlisting", () => {
    it("reports warnings for non-allowlisted external URLs without failing internal checks", () => {
      const result = runDocLinkChecker({ checkExternal: true });
      expect(result.internalErrors).toEqual([]);
      // External warnings should be an array (can be empty if all hosts allowlisted)
      expect(Array.isArray(result.externalWarnings)).toBe(true);
    });
  });
});
