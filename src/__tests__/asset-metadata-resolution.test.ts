// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveAssetMetadata,
  parseSep1TomlCurrencies,
  isSafeHomeDomain,
  clearDomainMetadataCache,
  getDomainMetadataCacheSize,
  setDomainMetadataCacheEntry,
  truncateIssuer,
  MAX_TOML_SIZE_BYTES,
  USDC_TESTNET,
  USDC_MAINNET,
  XLM_ASSET,
} from "@/lib/assets";

describe("Asset Metadata Resolution (Issue #824)", () => {
  beforeEach(() => {
    clearDomainMetadataCache();
    vi.restoreAllMocks();
  });

  describe("truncateIssuer helper", () => {
    it("truncates long Stellar issuer addresses to 4...4", () => {
      const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      expect(truncateIssuer(issuer)).toBe("GA5Z...KZVN");
    });

    it("handles short or empty strings safely", () => {
      expect(truncateIssuer("")).toBe("");
      expect(truncateIssuer("ABC")).toBe("ABC");
    });
  });

  describe("parseSep1TomlCurrencies", () => {
    it("parses valid SEP-1 [[CURRENCIES]] sections", () => {
      const toml = `
VERSION = "2.0.0"

[DOCUMENT_INFO]
ORG_NAME = "Ultra Stellar"

[[CURRENCIES]]
code = "AQUA"
issuer = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFQDUGSYNJWBCY6PBOMHGOMW34U"
name = "Aquarius"
desc = "Liquidity management protocol on Stellar"

[[CURRENCIES]]
code = "yXLM"
issuer = "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXMMEDEDBMY"
name = "Yield XLM"
desc = "Yield-generating XLM token"
`;
      const currencies = parseSep1TomlCurrencies(toml);
      expect(currencies.size).toBe(2);

      const aqua = currencies.get("AQUA");
      expect(aqua).toBeDefined();
      expect(aqua?.name).toBe("Aquarius");
      expect(aqua?.desc).toContain("Liquidity management");

      const yxlm = currencies.get("YXLM");
      expect(yxlm).toBeDefined();
      expect(yxlm?.name).toBe("Yield XLM");
    });

    it("gracefully ignores comments and malformed lines", () => {
      const toml = `
# Random comment
[SOME_OTHER_TABLE]
foo = "bar"

[[CURRENCIES]]
code = "TEST"
# bad line without equals
invalid syntax line here
name = "Test Token"
`;
      const currencies = parseSep1TomlCurrencies(toml);
      expect(currencies.size).toBe(1);
      expect(currencies.get("TEST")?.name).toBe("Test Token");
    });

    it("returns empty map on empty or invalid input", () => {
      expect(parseSep1TomlCurrencies("").size).toBe(0);
      expect(parseSep1TomlCurrencies(null as any).size).toBe(0);
    });
  });

  describe("isSafeHomeDomain SSRF validation", () => {
    it("allows valid public hostnames", () => {
      expect(isSafeHomeDomain("circle.com")).toBe(true);
      expect(isSafeHomeDomain("aqua.network")).toBe(true);
      expect(isSafeHomeDomain("stellar.org")).toBe(true);
      expect(isSafeHomeDomain("sub.domain.example.co.uk")).toBe(true);
    });

    it("blocks localhost, loopback, and private IPs", () => {
      expect(isSafeHomeDomain("localhost")).toBe(false);
      expect(isSafeHomeDomain("127.0.0.1")).toBe(false);
      expect(isSafeHomeDomain("169.254.169.254")).toBe(false);
      expect(isSafeHomeDomain("10.0.0.1")).toBe(false);
      expect(isSafeHomeDomain("192.168.1.1")).toBe(false);
      expect(isSafeHomeDomain("server.local")).toBe(false);
      expect(isSafeHomeDomain("internal.corp")).toBe(false);
    });

    it("rejects invalid domain syntax", () => {
      expect(isSafeHomeDomain("")).toBe(false);
      expect(isSafeHomeDomain("domain with spaces.com")).toBe(false);
      expect(isSafeHomeDomain("bad..domain.com")).toBe(false);
    });
  });

  describe("resolveAssetMetadata", () => {
    const validIssuer = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFQDUGSYNJWBCY6PBOMHGOMW34U";

    it("returns native XLM asset info directly", async () => {
      const res = await resolveAssetMetadata("XLM");
      expect(res).toEqual(XLM_ASSET);
    });

    it("returns known USDC info directly without network calls", async () => {
      const resTestnet = await resolveAssetMetadata("USDC", USDC_TESTNET.issuer);
      expect(resTestnet).toEqual(USDC_TESTNET);

      const resMainnet = await resolveAssetMetadata("USDC", USDC_MAINNET.issuer);
      expect(resMainnet).toEqual(USDC_MAINNET);
    });

    it("resolves display name from Horizon home_domain and SEP-1 TOML", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: "aqua.network",
        }),
      };

      const mockToml = `
[[CURRENCIES]]
code = "AQUA"
name = "Aquarius"
desc = "Liquidity token"
`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "100" }),
        text: async () => mockToml,
      });

      const res = await resolveAssetMetadata("AQUA", validIssuer, {
        horizonServer: mockHorizon,
      });

      expect(res.code).toBe("AQUA");
      expect(res.displayName).toBe("Aquarius (AQUA)");
      expect(res.orgName).toBe("Aquarius");
      expect(res.domain).toBe("aqua.network");
      expect(res.issuer).toBe(validIssuer);
      expect(getDomainMetadataCacheSize()).toBe(1);
    });

    it("uses domain cache on subsequent requests without re-fetching TOML", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: "cached.org",
        }),
      };

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "200" }),
        text: async () => `
[[CURRENCIES]]
code = "TOKEN"
name = "Cached Token"
`,
      });
      global.fetch = fetchSpy;

      // First call fetches
      const first = await resolveAssetMetadata("TOKEN", validIssuer, {
        horizonServer: mockHorizon,
      });
      expect(first.displayName).toBe("Cached Token (TOKEN)");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call for another issuer sharing the same domain hits cache
      const secondIssuer = "GCXKG6RN4ONIEPCMNFB732A436Z5PNDSRLGWK7GBLCMQLIFO4HXQNXB5";
      const second = await resolveAssetMetadata("TOKEN", secondIssuer, {
        horizonServer: mockHorizon,
      });
      expect(second.displayName).toBe("Cached Token (TOKEN)");
      expect(fetchSpy).toHaveBeenCalledTimes(1); // No second fetch!
    });

    it("degrades gracefully to code + issuer when home_domain is missing", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: null,
        }),
      };

      const res = await resolveAssetMetadata("MYTOKEN", validIssuer, {
        horizonServer: mockHorizon,
      });

      expect(res.code).toBe("MYTOKEN");
      expect(res.displayName).toBe("MYTOKEN (GBNZ...W34U)");
      expect(res.domain).toBeUndefined();
    });

    it("degrades gracefully when TOML fetch fails or returns 404", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: "nonexistent.example.com",
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const res = await resolveAssetMetadata("FAIL", validIssuer, {
        horizonServer: mockHorizon,
      });

      expect(res.code).toBe("FAIL");
      expect(res.displayName).toBe("FAIL (GBNZ...W34U)");
      expect(res.domain).toBe("nonexistent.example.com");
    });

    it("degrades gracefully when TOML fetch times out", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: "slow.example.com",
        }),
      };

      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 500));
      });

      const res = await resolveAssetMetadata("SLOW", validIssuer, {
        horizonServer: mockHorizon,
        timeoutMs: 50, // Short timeout
      });

      expect(res.code).toBe("SLOW");
      expect(res.displayName).toBe("SLOW (GBNZ...W34U)");
    });

    it("enforces MAX_TOML_SIZE_BYTES limit and rejects oversize TOML files", async () => {
      const mockHorizon = {
        loadAccount: vi.fn().mockResolvedValue({
          home_domain: "oversize.example.com",
        }),
      };

      const hugeText = "a".repeat(MAX_TOML_SIZE_BYTES + 1024);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": String(hugeText.length) }),
        text: async () => hugeText,
      });

      const res = await resolveAssetMetadata("HUGE", validIssuer, {
        horizonServer: mockHorizon,
      });

      // Must degrade without caching or crashing
      expect(res.displayName).toBe("HUGE (GBNZ...W34U)");
      expect(getDomainMetadataCacheSize()).toBe(0);
    });
  });
});
