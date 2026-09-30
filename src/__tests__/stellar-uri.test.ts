// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { buildReceivePayload, buildSep7PayUri } from "@/lib/stellar-uri";

const ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("buildSep7PayUri", () => {
  it("builds a web+stellar:pay URI with a destination", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
    expect(uri.startsWith("web+stellar:pay")).toBe(true);
  });

  it("rejects malformed destination values", () => {
    expect(() => buildSep7PayUri({ destination: "G A&B" })).toThrow(
      "Invalid Stellar destination address"
    );
    expect(() =>
      buildSep7PayUri({
        destination: "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF",
      })
    ).toThrow("Invalid Stellar destination address");
  });

  it("includes the amount when provided", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "12.5" });
    expect(uri).toContain(`destination=${ADDRESS}`);
    expect(uri).toContain("amount=12.5");
  });

  it("omits empty and malformed amounts", () => {
    expect(buildSep7PayUri({ destination: ADDRESS, amount: "" })).toBe(
      `web+stellar:pay?destination=${ADDRESS}`
    );
    expect(buildSep7PayUri({ destination: ADDRESS, amount: "1e3" })).toBe(
      `web+stellar:pay?destination=${ADDRESS}`
    );
    expect(
      buildSep7PayUri({
        destination: ADDRESS,
        amount: "922337203685.4775808",
      })
    ).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("includes memo with the SEP-7 default memo type", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, memo: "invoice-42" });
    expect(uri).toContain("memo=invoice-42");
    expect(uri).toContain("memo_type=MEMO_TEXT");
  });

  it("omits memo_type when no memo is given", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, memoType: "MEMO_TEXT" });
    expect(uri).not.toContain("memo_type");
  });

  it("omits invalid memos", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      memo: "x".repeat(29),
      memoType: "MEMO_TEXT",
    });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("encodes a memo identifier according to its declared type", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      memo: "42",
      memoType: "MEMO_ID",
    });
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("memo")).toBe("42");
    expect(parsed.searchParams.get("memo_type")).toBe("MEMO_ID");
  });

  it("encodes a non-native asset with its issuer", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      assetCode: "USDC",
      assetIssuer: ISSUER,
    });
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${ISSUER}`);
  });

  it("omits the asset entirely for native XLM (SEP-7)", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, assetCode: "XLM" });
    expect(uri).not.toContain("asset_code");
    expect(uri).not.toContain("asset_issuer");
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("omits the issuer when only the asset code is set", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, assetCode: "USDC" });
    expect(uri).toContain("asset_code=USDC");
    expect(uri).not.toContain("asset_issuer");
  });

  it("omits unsafe asset codes and issuer values", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      assetCode: "USDC&amount=100",
      assetIssuer: "G invalid",
    });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("includes a human-readable message", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, msg: "Thanks!" });
    expect(uri).toContain("msg=Thanks%21");
  });

  it("keeps params URL-encoded and round-trippable", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      memo: "hello world & more",
    });
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("memo")).toBe("hello world & more");
  });
});

describe("buildReceivePayload", () => {
  it("encodes just the address for receive", () => {
    expect(buildReceivePayload(ADDRESS)).toBe(
      `web+stellar:pay?destination=${ADDRESS}`
    );
  });

  it("rejects malformed addresses", () => {
    expect(() => buildReceivePayload("GABC 123")).toThrow(
      "Invalid Stellar destination address"
    );
  });
});
