// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveAssetMetadata,
  formatAssetDisplay,
  stellarTomlUrl,
  resetAssetMetadataCache,
  type StellarTomlDocument,
} from "@/lib/asset-metadata";
import { TimeoutError } from "@/lib/timeout";

const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const tomlWith = (
  currencies: StellarTomlDocument["CURRENCIES"]
): StellarTomlDocument => ({
  CURRENCIES: currencies,
  DOCUMENTATION: { ORG_NAME: "Example Org" },
});

/** A permissive guard so tests never touch DNS. */
const safeDomain = vi.fn(async () => true);

// The asset-metadata cache is process-global; reset it per case so a cached
// TOML from one test cannot satisfy another.
beforeEach(() => resetAssetMetadataCache());

function deps(overrides: Record<string, unknown> = {}) {
  return {
    fetchHomeDomain: vi.fn(async () => "example.com"),
    resolveToml: vi.fn(async () =>
      tomlWith([
        { code: "USDC", issuer: ISSUER, name: "USD Coin", desc: "A stablecoin", display_decimals: 2 },
      ])
    ),
    isSafeDomain: safeDomain,
    now: () => 1_000_000,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("stellarTomlUrl", () => {
  it("builds the SEP-1 discovery URL", () => {
    expect(stellarTomlUrl("example.com")).toBe(
      "https://example.com/.well-known/stellar.toml"
    );
  });
});

describe("resolveAssetMetadata", () => {
  it("resolves a known issuer to a display name", async () => {
    const d = deps();
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);

    expect(meta.name).toBe("USD Coin");
    expect(meta.description).toBe("A stablecoin");
    expect(meta.decimals).toBe(2);
    expect(meta.orgName).toBe("Example Org");
    expect(meta.homeDomain).toBe("example.com");
    expect(meta.source).toBe("toml");
    expect(formatAssetDisplay(meta)).toBe("USD Coin (USDC)");
  });

  it("matches the code case-insensitively", async () => {
    const d = deps();
    const meta = await resolveAssetMetadata({ code: "usdc", issuer: ISSUER }, d);
    expect(meta.name).toBe("USD Coin");
  });

  it("caches the TOML per issuer domain and reports a cache hit", async () => {
    const d = deps();
    await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);

    const second = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, {
      ...d,
      now: () => 1_000_100,
    });

    expect(d.resolveToml).toHaveBeenCalledTimes(1);
    expect(second.source).toBe("cache");
    expect(second.name).toBe("USD Coin");
  });

  it("shares one TOML fetch across assets from the same domain", async () => {
    const d = deps({
      resolveToml: vi.fn(async () =>
        tomlWith([
          { code: "USDC", issuer: ISSUER, name: "USD Coin" },
          { code: "EURC", issuer: OTHER_ISSUER, name: "Euro Coin" },
        ])
      ),
    });

    await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    const eurc = await resolveAssetMetadata({ code: "EURC", issuer: OTHER_ISSUER }, d);

    expect(d.resolveToml).toHaveBeenCalledTimes(1);
    expect(eurc.name).toBe("Euro Coin");
  });

  it("degrades to code + issuer when the currency is absent", async () => {
    const d = deps({
      resolveToml: vi.fn(async () => tomlWith([{ code: "EURC", issuer: OTHER_ISSUER }])),
    });
    const meta = await resolveAssetMetadata({ code: "NOPE", issuer: ISSUER }, d);

    expect(meta.name).toBeNull();
    expect(meta.source).toBe("fallback");
    expect(meta.homeDomain).toBe("example.com");
    expect(formatAssetDisplay(meta)).toBe("NOPE");
  });

  it("degrades when the issuer has no home domain", async () => {
    const d = deps({ fetchHomeDomain: vi.fn(async () => null) });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);

    expect(meta.source).toBe("fallback");
    expect(meta.homeDomain).toBeNull();
    expect(d.resolveToml).not.toHaveBeenCalled();
  });

  it("degrades when the home-domain lookup throws", async () => {
    const d = deps({
      fetchHomeDomain: vi.fn(async () => {
        throw new Error("Horizon down");
      }),
    });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.source).toBe("fallback");
  });

  it("degrades on malformed/unparseable TOML without throwing", async () => {
    const d = deps({
      resolveToml: vi.fn(async () => {
        throw new Error("Invalid TOML");
      }),
    });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.source).toBe("fallback");
    expect(meta.name).toBeNull();
  });

  it("degrades on a TOML fetch timeout", async () => {
    const d = deps({
      resolveToml: vi.fn(async () => {
        throw new TimeoutError(10_000, "stellar.toml");
      }),
    });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.source).toBe("fallback");
  });

  it("rejects a domain the URL guard blocks before fetching", async () => {
    const d = deps({ isSafeDomain: vi.fn(async () => false) });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.source).toBe("fallback");
    expect(d.resolveToml).not.toHaveBeenCalled();
  });

  it("reports a missing name for a TOML currency without one", async () => {
    const d = deps({
      resolveToml: vi.fn(async () => tomlWith([{ code: "USDC", issuer: ISSUER }])),
    });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.name).toBeNull();
    // A present currency with no `name` still resolves from the TOML.
    expect(meta.source).toBe("toml");
  });

  it("ignores a currency whose issuer does not match", async () => {
    const d = deps({
      resolveToml: vi.fn(async () =>
        tomlWith([{ code: "USDC", issuer: OTHER_ISSUER, name: "Wrong Coin" }])
      ),
    });
    const meta = await resolveAssetMetadata({ code: "USDC", issuer: ISSUER }, d);
    expect(meta.name).toBeNull();
    expect(meta.source).toBe("fallback");
  });
});

describe("formatAssetDisplay", () => {
  it("prefers the resolved name", () => {
    expect(formatAssetDisplay({ code: "USDC", name: "USD Coin" })).toBe("USD Coin (USDC)");
  });
  it("falls back to the raw code", () => {
    expect(formatAssetDisplay({ code: "USDC", name: null })).toBe("USDC");
  });
});
