// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveAssetMetadata,
  parseStellarTomlCurrencies,
  clearAssetMetadataCache,
  isValidHomeDomain,
  ASSET_METADATA_CACHE_TTL_MS,
} from "@/lib/asset-metadata";
import { getAssetDisplayParts, shortenAssetIssuer } from "@/lib/assets";

// ── Fixtures ───────────────────────────────────────────────────

const ISSUER = `G${"B".repeat(55)}`;
const OTHER_ISSUER = `G${"C".repeat(55)}`;
const HORIZON = "https://horizon.example.com";
const DOMAIN = "assets.example.com";
const TOML_URL = `https://${DOMAIN}/.well-known/stellar.toml`;

const VALID_TOML = `
# Example issuer stellar.toml
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

[DOCUMENTATION]
ORG_NAME = "Example Inc"

[[CURRENCIES]]
code = "yUSDC"
issuer = "${ISSUER}"
name = "Example USD Coin"
desc = "A test USD token" # trailing comment
display_decimals = 2
is_asset_anchored = true

[[CURRENCIES]]
code = "GOLD"
name = "Gold Token"
`;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

/** Route-aware fetch mock that records every requested URL. Route values may
 * be a Response (single-use) or a factory returning a fresh Response. */
function mockFetch(routes: Record<string, FetchHandler | (() => Response) | Response>) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);
    for (const [prefix, route] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        if (route instanceof Response) return route;
        return (route as FetchHandler)(url, init);
      }
    }
    return new Response("not found", { status: 404 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, fetchMock: fetchFn };
}

// Factories, not shared Response instances — a Response body can only be
// consumed once, so each fetch must get a fresh one.
const baseRoutes = {
  [`${HORIZON}/accounts/`]: () => jsonResponse({ home_domain: DOMAIN }),
  [TOML_URL]: () => textResponse(VALID_TOML),
};

const opts = { horizonUrl: HORIZON };

describe("asset-metadata (SEP-1 TOML resolution)", () => {
  beforeEach(() => {
    clearAssetMetadataCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearAssetMetadataCache();
    vi.restoreAllMocks();
  });

  // ── Resolution ───────────────────────────────────────────────

  describe("resolveAssetMetadata", () => {
    it("resolves a display name for a known issuer via its home-domain TOML", async () => {
      const { fetchFn } = mockFetch(baseRoutes);

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });

      expect(result.resolved).toBe(true);
      expect(result.name).toBe("Example USD Coin");
      expect(result.domain).toBe(DOMAIN);
      expect(result.displayDecimals).toBe(2);
    });

    it("caches per issuer domain: a second asset on the same domain makes no new fetches", async () => {
      const { fetchFn, calls } = mockFetch(baseRoutes);

      const first = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });
      expect(first.resolved).toBe(true);
      expect(calls).toHaveLength(2); // Horizon account + TOML

      const second = await resolveAssetMetadata("GOLD", ISSUER, {
        ...opts,
        fetchFn,
      });
      expect(second.resolved).toBe(true);
      expect(second.name).toBe("Gold Token");
      // No additional network calls — both caches served the lookup.
      expect(calls).toHaveLength(2);
    });

    it("caches per domain, not per asset: the TOML is fetched once for many codes", async () => {
      const { fetchFn, calls } = mockFetch(baseRoutes);

      await resolveAssetMetadata("yUSDC", ISSUER, { ...opts, fetchFn });
      await resolveAssetMetadata("GOLD", ISSUER, { ...opts, fetchFn });
      await resolveAssetMetadata("MISSING", ISSUER, { ...opts, fetchFn });

      const tomlFetches = calls.filter((u) => u === TOML_URL);
      expect(tomlFetches).toHaveLength(1);
    });

    it("refetches after the TTL expires", async () => {
      vi.useFakeTimers();
      try {
        const { fetchFn, calls } = mockFetch(baseRoutes);

        await resolveAssetMetadata("yUSDC", ISSUER, { ...opts, fetchFn });
        expect(calls).toHaveLength(2);

        vi.setSystemTime(Date.now() + ASSET_METADATA_CACHE_TTL_MS + 1);

        await resolveAssetMetadata("yUSDC", ISSUER, { ...opts, fetchFn });
        expect(calls).toHaveLength(4); // Horizon + TOML fetched again
      } finally {
        vi.useRealTimers();
      }
    });

    // ── Degradation paths (no error surface) ───────────────────

    it("degrades to code + issuer when the account has no home_domain", async () => {
      const { fetchFn } = mockFetch({
        [`${HORIZON}/accounts/`]: jsonResponse({}),
      });

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });

      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
      expect(result.domain).toBeNull();
    });

    it("degrades when the TOML has no matching currency", async () => {
      const { fetchFn } = mockFetch(baseRoutes);

      const result = await resolveAssetMetadata("NOPE", ISSUER, {
        ...opts,
        fetchFn,
      });

      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
      expect(result.domain).toBe(DOMAIN); // domain known, asset not listed
    });

    it("degrades when the TOML currency entry has no name", async () => {
      const { fetchFn } = mockFetch({
        ...baseRoutes,
        [TOML_URL]: textResponse(`[[CURRENCIES]]\ncode = "yUSDC"\n`),
      });

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });

      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
    });

    it("degrades on malformed TOML and negatively caches the domain", async () => {
      const { fetchFn, calls } = mockFetch({
        ...baseRoutes,
        [TOML_URL]: textResponse(
          `[[CURRENCIES]]\ncode = "UNTERMINATED\nname = "oops"\n`,
        ),
      });

      const first = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });
      expect(first.resolved).toBe(false);
      expect(first.name).toBeNull();

      const second = await resolveAssetMetadata("GOLD", ISSUER, {
        ...opts,
        fetchFn,
      });
      expect(second.resolved).toBe(false);

      // One TOML fetch total — the failure is cached per domain.
      expect(calls.filter((u) => u === TOML_URL)).toHaveLength(1);
    });

    it("degrades on TOML fetch timeout", async () => {
      const { fetchFn } = mockFetch({
        [`${HORIZON}/accounts/`]: jsonResponse({ home_domain: DOMAIN }),
        [TOML_URL]: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError")),
            );
          }),
      });

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
        timeoutMs: 25,
      });

      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
      expect(result.domain).toBe(DOMAIN);
    });

    it("degrades when the TOML exceeds the size limit", async () => {
      const oversized = `[[CURRENCIES]]\ncode = "yUSDC"\nname = "${"x".repeat(256)}"\n`;
      const { fetchFn } = mockFetch({
        ...baseRoutes,
        [TOML_URL]: textResponse(oversized),
      });

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
        maxTomlBytes: 64,
      });

      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
    });

    it("rejects a home domain that fails the shared URL safety guard (SSRF)", async () => {
      const { fetchFn, calls } = mockFetch({
        [`${HORIZON}/accounts/`]: jsonResponse({
          home_domain: "metadata.google.internal",
        }),
      });

      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn,
      });

      expect(result.resolved).toBe(false);
      // The internal domain is fetched exactly zero times.
      expect(calls.filter((u) => u.includes("metadata.google.internal"))).toHaveLength(0);
    });

    it("degrades when the issuer is not a valid Stellar account", async () => {
      const fetchMock = vi.fn();
      const result = await resolveAssetMetadata("yUSDC", "not-an-issuer", {
        ...opts,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(result.resolved).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("degrades when the asset code is invalid", async () => {
      const fetchMock = vi.fn();
      const result = await resolveAssetMetadata("bad code!", ISSUER, {
        ...opts,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(result.resolved).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("degrades when Horizon is unreachable", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await resolveAssetMetadata("yUSDC", ISSUER, {
        ...opts,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      expect(result.resolved).toBe(false);
      expect(result.domain).toBeNull();
    });

    it("does not resolve a TOML entry whose issuer does not match the asset issuer", async () => {
      const { fetchFn } = mockFetch(baseRoutes);

      const result = await resolveAssetMetadata("yUSDC", OTHER_ISSUER, {
        ...opts,
        fetchFn,
      });

      // The TOML entry for yUSDC names a different issuer — no match.
      expect(result.resolved).toBe(false);
      expect(result.name).toBeNull();
    });
  });

  // ── TOML parser ──────────────────────────────────────────────

  describe("parseStellarTomlCurrencies", () => {
    it("parses multiple CURRENCIES entries with mixed value types", () => {
      const currencies = parseStellarTomlCurrencies(VALID_TOML);

      expect(currencies).toHaveLength(2);
      expect(currencies[0]).toMatchObject({
        code: "yUSDC",
        issuer: ISSUER,
        name: "Example USD Coin",
        desc: "A test USD token",
        displayDecimals: 2,
      });
      expect(currencies[1]).toMatchObject({ code: "GOLD", name: "Gold Token" });
    });

    it("ignores non-CURRENCIES sections", () => {
      const currencies = parseStellarTomlCurrencies(VALID_TOML);
      expect(currencies.find((c) => c.code === "ORG_NAME")).toBeUndefined();
    });

    it("throws on an unterminated string", () => {
      expect(() =>
        parseStellarTomlCurrencies(`[[CURRENCIES]]\ncode = "BROKEN\n`),
      ).toThrow(/Unterminated string/);
    });

    it("throws on a bare line that is not key = value", () => {
      expect(() =>
        parseStellarTomlCurrencies(`this is not toml\n`),
      ).toThrow(/Malformed TOML line/);
    });

    it("throws on a malformed section header", () => {
      expect(() =>
        parseStellarTomlCurrencies(`[[CURRENCIES]\ncode = "X"\n`),
      ).toThrow(/Malformed TOML section header/);
    });

    it("handles escaped quotes inside strings", () => {
      const currencies = parseStellarTomlCurrencies(
        `[[CURRENCIES]]\ncode = "X"\nname = "Say \\"Hi\\""\n`,
      );
      expect(currencies[0]?.name).toBe(`Say "Hi"`);
    });
  });

  // ── Home domain validation ───────────────────────────────────

  describe("isValidHomeDomain", () => {
    it("accepts ordinary hostnames", () => {
      expect(isValidHomeDomain("example.com")).toBe(true);
      expect(isValidHomeDomain("assets.example.co.uk")).toBe(true);
    });

    it("rejects IPs, localhost, and malformed domains", () => {
      expect(isValidHomeDomain("127.0.0.1")).toBe(false);
      expect(isValidHomeDomain("localhost")).toBe(false);
      expect(isValidHomeDomain("https://example.com")).toBe(false);
      expect(isValidHomeDomain("example.com/evil")).toBe(false);
      expect(isValidHomeDomain("")).toBe(false);
    });
  });

  // ── Display fallbacks ────────────────────────────────────────

  describe("getAssetDisplayParts", () => {
    it("shows the resolved name alongside the code", () => {
      expect(getAssetDisplayParts("yUSDC", ISSUER, "Example USD Coin")).toEqual({
        title: "Example USD Coin",
        subtitle: "yUSDC",
      });
    });

    it("degrades to the raw code plus shortened issuer without metadata", () => {
      const parts = getAssetDisplayParts("yUSDC", ISSUER, null);
      expect(parts.title).toBe("yUSDC");
      expect(parts.subtitle).toBe(shortenAssetIssuer(ISSUER));
      expect(parts.subtitle).toContain("…");
    });

    it("shows only the code for assets without an issuer", () => {
      expect(getAssetDisplayParts("XLM", null, null)).toEqual({
        title: "XLM",
        subtitle: "",
      });
    });
  });
});
