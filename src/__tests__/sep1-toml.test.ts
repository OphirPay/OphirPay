import { describe, expect, it, vi } from "vitest";
import {
  clearSep1Cache,
  formatAssetLabel,
  parseStellarToml,
  resolveAssetMetadata,
} from "../lib/sep1-toml";

const TOML = `
# stellar.toml
[DOCUMENTATION]
ORG_NAME = "Circle Internet Financial"

[[CURRENCIES]]
code = "USDC"
issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
name = "USD Coin"
desc = "Fully reserved digital dollar"
display_decimals = 2
is_asset_anchored = true
anchor_asset = "USD"

[[CURRENCIES]]
code = "SHX"
issuer = "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEZQLIWQZOOZ4FJIY3DD3QNS"
name = "Stronghold"
`;

describe("parseStellarToml", () => {
  it("parses currencies, quotes and ints", () => {
    const toml = parseStellarToml(TOML);
    expect(toml.orgName).toBe("Circle Internet Financial");
    expect(toml.currencies).toHaveLength(2);
    expect(toml.currencies[0]).toMatchObject({
      code: "USDC",
      name: "USD Coin",
      displayDecimals: 2,
      isAssetAnchored: true,
      anchorAsset: "USD",
    });
  });

  it("ignores comments, blank lines and keys outside a table", () => {
    const toml = parseStellarToml(`ACCOUNT = "GABC"\n\n# c\n[[CURRENCIES]]\ncode = "X"\n`);
    expect(toml.currencies).toHaveLength(1);
    expect(toml.currencies[0]!.code).toBe("X");
  });

  it("drops currency tables without a code", () => {
    expect(parseStellarToml("[[CURRENCIES]]\nname = \"n\"\n").currencies).toHaveLength(0);
  });

  it("handles CRLF and single quotes", () => {
    const toml = parseStellarToml("[[CURRENCIES]]\r\ncode = 'EUR'\r\nname = 'Euro'\r\n");
    expect(toml.currencies[0]).toMatchObject({ code: "EUR", name: "Euro" });
  });
});

describe("resolveAssetMetadata", () => {
  const fetchImpl = (async () =>
    new Response(TOML, { status: 200 })) as unknown as typeof fetch;

  it("matches by code and issuer", async () => {
    clearSep1Cache();
    const md = await resolveAssetMetadata(
      "usdc",
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "circle.com",
      { fetchImpl },
    );
    expect(md.source).toBe("sep1");
    expect(md.decimals).toBe(2);
    expect(formatAssetLabel(md)).toBe("USD Coin (USDC)");
  });

  it("does not match a different issuer with the same code", async () => {
    clearSep1Cache();
    const md = await resolveAssetMetadata("USDC", "GOTHER", "circle.com", { fetchImpl });
    expect(md.source).toBe("fallback");
  });

  it("falls back without a home domain and makes no request", async () => {
    const spy = vi.fn();
    const md = await resolveAssetMetadata("USDC", "GABC", undefined, {
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(md).toMatchObject({ code: "USDC", decimals: 7, source: "fallback" });
  });

  it("degrades to fallback on network error", async () => {
    clearSep1Cache();
    const boom = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const md = await resolveAssetMetadata("USDC", "GABC", "nope.invalid", { fetchImpl: boom });
    expect(md.source).toBe("fallback");
  });

  it("degrades to fallback on 404", async () => {
    clearSep1Cache();
    const notFound = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch;
    const md = await resolveAssetMetadata("USDC", "GABC", "circle.com", { fetchImpl: notFound });
    expect(md.source).toBe("fallback");
  });

  it("caches per home domain within the TTL", async () => {
    clearSep1Cache();
    const spy = vi.fn(async () => new Response(TOML, { status: 200 }));
    const opts = { fetchImpl: spy as unknown as typeof fetch };
    await resolveAssetMetadata("USDC", undefined, "circle.com", opts);
    await resolveAssetMetadata("USDC", undefined, "circle.com", opts);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    clearSep1Cache();
    let now = 0;
    const spy = vi.fn(async () => new Response(TOML, { status: 200 }));
    const opts = {
      fetchImpl: spy as unknown as typeof fetch,
      ttlMs: 100,
      now: () => now,
    };
    await resolveAssetMetadata("USDC", undefined, "circle.com", opts);
    now = 1_000;
    await resolveAssetMetadata("USDC", undefined, "circle.com", opts);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("refuses non-https home domains", async () => {
    clearSep1Cache();
    const spy = vi.fn();
    const md = await resolveAssetMetadata("USDC", "GABC", "evil.com", {
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(md.source).toBe("fallback");
  });
});

describe("formatAssetLabel", () => {
  it("returns the bare code when the name equals the code", () => {
    expect(formatAssetLabel({ code: "USDC", decimals: 7, source: "fallback", name: "usdc" })).toBe(
      "USDC",
    );
  });
});
