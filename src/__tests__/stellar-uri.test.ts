// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  buildReceivePayload,
  buildSep7PayUri,
  parseSep7PayUri,
  isValidSep7Uri,
} from "@/lib/stellar-uri";

const ADDRESS = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF";

describe("buildSep7PayUri", () => {
  it("builds a web+stellar:pay URI with a destination", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
    expect(uri.startsWith("web+stellar:pay")).toBe(true);
  });

  it("encodes special characters in the destination", () => {
    const uri = buildSep7PayUri({ destination: "G A&B" });
    expect(uri).toBe("web+stellar:pay?destination=G+A%26B");
  });

  it("includes the amount when provided", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "12.5" });
    expect(uri).toContain("destination=" + ADDRESS);
    expect(uri).toContain("amount=12.5");
  });

  it("omits the amount when empty", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "" });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("includes memo and memo_type", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      memo: "invoice-42",
      memoType: "MEMO_TEXT",
    });
    expect(uri).toContain("memo=invoice-42");
    expect(uri).toContain("memo_type=MEMO_TEXT");
  });

  it("omits memo_type when no memo is given", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, memoType: "MEMO_TEXT" });
    expect(uri).not.toContain("memo_type");
  });

  it("encodes a non-native asset with its issuer", () => {
    const issuer = "GAIUEOOO3B4KX3Q4XWQPQK3G2Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z";
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      assetCode: "USDC",
      assetIssuer: issuer,
    });
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${issuer}`);
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

  it("includes a human-readable message", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, msg: "Thanks!" });
    expect(uri).toContain("msg=Thanks%21");
  });

  it("keeps params URL-encoded and round-trippable", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, memo: "hello world & more" });
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

  it("handles addresses with special characters", () => {
    const uri = buildReceivePayload("GABC 123");
    expect(uri).toBe("web+stellar:pay?destination=GABC+123");
  });
});

describe("parseSep7PayUri (issue #812)", () => {
  it("round-trips every field the builder emits", () => {
    const issuer = "GAIUEOOO3B4KX3Q4XWQPQK3G2Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z";
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      amount: "12.5",
      memo: "invoice-42",
      memoType: "MEMO_TEXT",
      assetCode: "USDC",
      assetIssuer: issuer,
      msg: "Thanks!",
    });

    expect(parseSep7PayUri(uri)).toEqual({
      destination: ADDRESS,
      amount: "12.5",
      memo: "invoice-42",
      memoType: "MEMO_TEXT",
      assetCode: "USDC",
      assetIssuer: issuer,
      msg: "Thanks!",
    });
  });

  it("returns null for non-SEP-7 input", () => {
    expect(parseSep7PayUri("https://example.com/pay")).toBeNull();
    expect(parseSep7PayUri("stellar:pay?destination=X")).toBeNull();
    expect(parseSep7PayUri("web+stellar:tx?destination=X")).toBeNull();
    expect(parseSep7PayUri("not a uri")).toBeNull();
  });
});

describe("isValidSep7Uri (issue #812)", () => {
  it("accepts a complete handoff", () => {
    expect(
      isValidSep7Uri(
        buildSep7PayUri({ destination: ADDRESS, amount: "10", memo: "hi" })
      )
    ).toBe(true);
  });

  it("rejects bad amounts, orphaned memo_type and native-asset issuers", () => {
    expect(
      isValidSep7Uri(`web+stellar:pay?destination=${ADDRESS}&amount=abc`)
    ).toBe(false);
    expect(
      isValidSep7Uri(`web+stellar:pay?destination=${ADDRESS}&amount=-5`)
    ).toBe(false);
    expect(
      isValidSep7Uri(`web+stellar:pay?destination=${ADDRESS}&memo_type=MEMO_TEXT`)
    ).toBe(false);
    expect(
      isValidSep7Uri(
        `web+stellar:pay?destination=${ADDRESS}&asset_code=XLM&asset_issuer=GISSUER`
      )
    ).toBe(false);
  });
});
